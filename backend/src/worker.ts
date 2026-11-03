import { Worker } from "bullmq";
import { env } from "./config/env.js";
import { prisma } from "./config/db.js";
import { redis, createWorkerConnection } from "./config/redis.js";
import { logger } from "./utils/logger.js";
import { closeQueues } from "./queues/index.js";
import { processEmail, type EmailJob } from "./workers/email-worker.js";
import {
  indexEmail,
  searchClient,
} from "./integrations/elasticsearch/search.js";
import { notifyRateLimit } from "./integrations/slack/notify.js";
import type { RateEvent } from "./services/rate-limit.js";
import { startRecoveryListener } from "./services/reconcile.js";

const connections = [
  createWorkerConnection(),
  createWorkerConnection(),
  createWorkerConnection(),
];
const emailWorker = new Worker<EmailJob>("emails", processEmail, {
  connection: connections[0]!,
  concurrency: env.WORKER_CONCURRENCY,
  lockDuration: env.SMTP_TIMEOUT_MS * 3 + 60000,
  maxStalledCount: 2,
});
const indexWorker = new Worker<{ emailId: string }>(
  "email-index",
  (job) => indexEmail(job.data.emailId),
  { connection: connections[1]!, concurrency: 4 },
);
const slackWorker = new Worker<RateEvent>(
  "slack-notifications",
  (job) => notifyRateLimit(job.data),
  { connection: connections[2]!, concurrency: 2 },
);
const workers = [emailWorker, indexWorker, slackWorker];
for (const worker of workers) {
  worker.on("error", (error) =>
    logger.error({ err: error, queue: worker.name }, "Queue worker error"),
  );
  worker.on("failed", (job, error) =>
    logger.warn(
      { err: error, queue: worker.name, jobId: job?.id },
      "Queue job attempt failed",
    ),
  );
}
emailWorker.on("failed", (job, error) => {
  if (
    job &&
    (job.attemptsMade >= (job.opts.attempts ?? 1) ||
      error.message.includes("stalled"))
  ) {
    void prisma.email
      .updateMany({
        where: {
          id: job.data.emailId,
          status: { in: ["SCHEDULED", "PROCESSING"] },
        },
        data: {
          status: "FAILED",
          errorMessage: error.message.slice(0, 2000),
          processingAt: null,
          indexDirty: true,
        },
      })
      .catch((err) =>
        logger.error(
          { err, jobId: job.id },
          "Could not record terminal job failure",
        ),
      );
  }
});
const stopRecovery = await startRecoveryListener();
logger.info(
  { concurrency: env.WORKER_CONCURRENCY },
  "Email, search and Slack workers started",
);
let stopping = false;
async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "Draining workers");
  const deadline = setTimeout(
    () => process.exit(1),
    env.SMTP_TIMEOUT_MS + 30000,
  ).unref();
  await Promise.all(workers.map((worker) => worker.close()));
  await stopRecovery();
  await closeQueues();
  await Promise.all(connections.map((connection) => connection.quit()));
  await searchClient.close();
  await redis.quit();
  await prisma.$disconnect();
  clearTimeout(deadline);
}
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => {
    void shutdown(signal).catch((error) => {
      logger.error({ err: error }, "Shutdown failed");
      process.exitCode = 1;
    });
  });
