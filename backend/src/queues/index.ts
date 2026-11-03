import { Queue } from "bullmq";
import { redis } from "../config/redis.js";

const defaults = {
  attempts: 5,
  backoff: { type: "exponential", delay: 5000 },
  removeOnComplete: { age: 7 * 86400, count: 10000 },
  removeOnFail: { age: 30 * 86400, count: 20000 },
};
export const emailQueue = new Queue("emails", {
  connection: redis,
  defaultJobOptions: defaults,
});
export const indexQueue = new Queue("email-index", {
  connection: redis,
  defaultJobOptions: {
    ...defaults,
    attempts: 20,
    backoff: { type: "exponential", delay: 2000 },
  },
});
export const slackQueue = new Queue("slack-notifications", {
  connection: redis,
  defaultJobOptions: { ...defaults, attempts: 10 },
});

export async function enqueueEmails(
  emails: { id: string; bullJobId: string; scheduledAt: Date }[],
) {
  for (let offset = 0; offset < emails.length; offset += 500) {
    await emailQueue.addBulk(
      emails.slice(offset, offset + 500).map((email) => ({
        name: "send",
        data: { emailId: email.id },
        opts: {
          jobId: email.bullJobId,
          delay: Math.max(0, email.scheduledAt.getTime() - Date.now()),
        },
      })),
    );
  }
}

export async function enqueueIndex(
  emails: { id: string; updatedAt: Date; searchVersion: number }[],
) {
  for (let offset = 0; offset < emails.length; offset += 500) {
    await indexQueue.addBulk(
      emails.slice(offset, offset + 500).map((email) => ({
        name: "index",
        data: { emailId: email.id },
        opts: { jobId: `index-${email.id}-${email.searchVersion}` },
      })),
    );
  }
}
export async function closeQueues() {
  await Promise.all([
    emailQueue.close(),
    indexQueue.close(),
    slackQueue.close(),
  ]);
}
