import { randomUUID } from "node:crypto";
import { DelayedError, type Job } from "bullmq";
import { prisma } from "../config/db.js";
import { redis } from "../config/redis.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { sendEmail } from "../integrations/email/send.js";
import { dispatchSlackOutbox } from "../integrations/slack/notify.js";
import { enqueueIndex } from "../queues/index.js";
import {
  leaseKey,
  releaseSender,
  reserveSend,
  renewScript,
} from "../services/rate-limit.js";

export interface EmailJob {
  emailId: string;
}
const leaseMs = () => env.SMTP_TIMEOUT_MS * 2 + 30000;
async function defer(job: Job<EmailJob>, timestamp: number, token?: string) {
  const next = new Date(Math.max(timestamp, Date.now() + 100));
  await prisma.email.updateMany({
    where: {
      id: job.data.emailId,
      status: { in: ["SCHEDULED", "PROCESSING"] },
    },
    data: {
      status: "SCHEDULED",
      processingAt: null,
      scheduledAt: next,
      indexDirty: true,
    },
  });
  await job.moveToDelayed(next.getTime(), token);
  throw new DelayedError();
}

export async function processEmail(job: Job<EmailJob>, jobToken?: string) {
  let email = await prisma.email.findUnique({
    where: { id: job.data.emailId },
    include: { sender: true },
  });
  if (!email || email.status === "SENT" || email.status === "FAILED") return;
  if (email.scheduledAt.getTime() > Date.now())
    return defer(job, email.scheduledAt.getTime(), jobToken);
  const token = randomUUID();
  const delayMs =
    Math.max(
      email.delaySeconds,
      email.sender.minDelaySeconds,
      env.MIN_DELAY_SECONDS,
    ) * 1000;
  if (
    !(await redis.set(leaseKey(email.senderId), token, "PX", leaseMs(), "NX"))
  ) {
    return defer(job, Date.now() + Math.max(1000, delayMs), jobToken);
  }
  let attempted = false;
  try {
    // A later job must not overtake an older pending email from the same sender.
    const previous = await prisma.email.findFirst({
      where: {
        senderId: email.senderId,
        status: { in: ["SCHEDULED", "PROCESSING"] },
        OR: [
          { originalScheduledAt: { lt: email.originalScheduledAt } },
          {
            originalScheduledAt: email.originalScheduledAt,
            id: { lt: email.id },
          },
        ],
      },
      orderBy: [{ originalScheduledAt: "asc" }, { id: "asc" }],
      select: { scheduledAt: true },
    });
    if (previous)
      return await defer(
        job,
        Math.max(
          Date.now() + Math.max(1000, delayMs),
          previous.scheduledAt.getTime() + Math.max(1000, delayMs),
        ),
        jobToken,
      );
    const claimed = await prisma.email.updateMany({
      where: {
        id: email.id,
        OR: [
          { status: "SCHEDULED" },
          {
            status: "PROCESSING",
            processingAt: { lt: new Date(Date.now() - leaseMs()) },
          },
        ],
      },
      data: {
        status: "PROCESSING",
        processingAt: new Date(),
        indexDirty: true,
      },
    });
    if (!claimed.count)
      return await defer(job, Date.now() + leaseMs(), jobToken);
    email = (await prisma.email.findUnique({
      where: { id: email.id },
      include: { sender: true },
    }))!;
    const limit = Math.min(
      email.hourlyLimit,
      email.sender.hourlyLimit,
      env.SYSTEM_MAX_EMAILS_PER_HOUR,
    );
    const reservation = await reserveSend(redis, {
      senderId: email.senderId,
      userId: email.userId,
      senderEmail: email.sender.email,
      token,
      attemptId: `${email.id}-${email.attempts + 1}`,
      limit,
      delayMs,
    });
    if (!reservation.allowed)
      return await defer(
        job,
        reservation.leaseLost
          ? Date.now() + leaseMs()
          : reservation.nextAvailable,
        jobToken,
      );
    // Publish the cap event before starting SMTP, which can take up to SMTP_TIMEOUT_MS.
    // Notification delivery runs in its own worker and never waits for mail delivery.
    if (reservation.count >= limit)
      await dispatchSlackOutbox().catch((error) =>
        logger.warn({ err: error }, "Slack outbox retained for recovery"),
      );
    await prisma.email.update({
      where: { id: email.id },
      data: { attempts: { increment: 1 } },
    });
    // Redis failures prevent SMTP. An accepted reservation counts conservatively even if the process dies here.
    const previewUrl = await sendEmail(email, email.sender, async () => {
      const ownsLease = await redis.eval(
        renewScript,
        1,
        leaseKey(email!.senderId),
        token,
        leaseMs(),
      );
      if (ownsLease !== 1)
        throw new Error(
          "Sender lease expired before SMTP; send was not attempted",
        );
      attempted = true;
    });
    await prisma.email.update({
      where: { id: email.id },
      data: {
        status: "SENT",
        sentAt: new Date(),
        previewUrl,
        errorMessage: null,
        processingAt: null,
        indexDirty: true,
      },
    });
  } catch (error) {
    if (error instanceof DelayedError) throw error;
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const message =
      error instanceof Error ? error.message : "Unknown send error";
    // If recording success failed after SMTP acceptance, a retry can duplicate delivery. See README.
    await prisma.email
      .updateMany({
        where: { id: email.id, status: { notIn: ["SENT", "FAILED"] } },
        data: {
          status: finalAttempt ? "FAILED" : "SCHEDULED",
          errorMessage: message.slice(0, 2000),
          processingAt: null,
          indexDirty: true,
        },
      })
      .catch((dbError) =>
        logger.error(
          { err: dbError, emailId: email!.id },
          "Could not persist send failure",
        ),
      );
    throw error;
  } finally {
    // Deferrals do not advance the minimum-delay clock. Actual attempts do, including SMTP failures.
    await releaseSender(
      redis,
      email.senderId,
      token,
      attempted ? delayMs : 0,
    ).catch((error) => logger.warn({ err: error }, "Sender lease will expire"));
    await dispatchSlackOutbox().catch((error) =>
      logger.warn({ err: error }, "Slack outbox retained for recovery"),
    );
    const latest = await prisma.email
      .findUnique({
        where: { id: email.id },
        select: { id: true, updatedAt: true, searchVersion: true },
      })
      .catch(() => null);
    if (latest)
      await enqueueIndex([latest]).catch((error) =>
        logger.warn({ err: error }, "Index remains dirty for recovery"),
      );
  }
}
