import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { enqueueEmails, enqueueIndex } from "../queues/index.js";
import {
  scheduleSchema,
  scheduleTimes,
  type ScheduleInput,
} from "../validators/schedule.js";

function httpError(statusCode: number, message: string) {
  return Object.assign(new Error(message), { statusCode });
}
export function requestHash(input: ScheduleInput) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function scheduleEmails(
  userId: string,
  rawInput: ScheduleInput,
  idempotencyKey: string,
) {
  const input = scheduleSchema.parse(rawInput);
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(idempotencyKey))
    throw httpError(
      400,
      "Idempotency-Key must contain 16–128 letters, numbers, underscores or hyphens",
    );
  const hash = requestHash(input);
  // Replays are checked before time validation: the original request can be replayed after its start time.
  const existing = await prisma.scheduleBatch.findUnique({
    where: { userId_idempotencyKey: { userId, idempotencyKey } },
  });
  if (existing) return replay(existing, hash);
  if (Date.parse(input.startTime) < Date.now())
    throw httpError(400, "Start time must be in the future");
  if (Date.parse(input.startTime) > Date.now() + 365 * 86400000)
    throw httpError(400, "Start time must be within one year");
  const sender = await prisma.sender.findFirst({
    where: { id: input.senderId, userId },
  });
  if (!sender) throw httpError(404, "Sender not found");
  if (input.hourlyLimit > env.SYSTEM_MAX_EMAILS_PER_HOUR)
    throw httpError(400, "Hourly limit exceeds the system maximum");
  if (
    input.delaySeconds < Math.max(sender.minDelaySeconds, env.MIN_DELAY_SECONDS)
  ) {
    throw httpError(
      400,
      `Delay must be at least ${Math.max(sender.minDelaySeconds, env.MIN_DELAY_SECONDS)} seconds`,
    );
  }
  const batchId = randomUUID();
  const times = scheduleTimes(
    input.startTime,
    input.recipients.length,
    input.delaySeconds,
  );
  const rows = input.recipients.map((recipient, index) => {
    const id = randomUUID();
    return {
      id,
      userId,
      senderId: sender.id,
      batchId,
      recipient,
      subject: input.subject,
      body: input.body,
      bodyHtml: input.bodyHtml,
      scheduledAt: times[index]!,
      originalScheduledAt: times[index]!,
      bullJobId: `email-${id}`,
      idempotencyKey: createHash("sha256")
        .update(`${userId}\0${idempotencyKey}\0${recipient}`)
        .digest("hex"),
      delaySeconds: input.delaySeconds,
      hourlyLimit: input.hourlyLimit,
    };
  });
  try {
    await prisma.$transaction(async (tx) => {
      await tx.scheduleBatch.create({
        data: {
          id: batchId,
          userId,
          senderId: sender.id,
          idempotencyKey,
          requestHash: hash,
          attachments: input.attachments?.length
            ? {
                create: input.attachments.map((file) => ({
                  filename: file.filename,
                  contentType: file.contentType,
                  content: Buffer.from(file.content, "base64"),
                  size: Buffer.from(file.content, "base64").length,
                })),
              }
            : undefined,
        },
      });
      await tx.email.createMany({ data: rows });
      // The database trigger emits transactional LISTEN/NOTIFY wakeups for these durable rows.
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const concurrent = await prisma.scheduleBatch.findUnique({
        where: { userId_idempotencyKey: { userId, idempotencyKey } },
      });
      if (concurrent) return replay(concurrent, hash);
    }
    throw error;
  }
  let queuePending = false;
  try {
    await enqueueEmails(rows);
    const records = await prisma.email.findMany({
      where: { batchId },
      select: { id: true, updatedAt: true, searchVersion: true },
    });
    await enqueueIndex(records);
  } catch (error) {
    queuePending = true;
    logger.warn(
      { err: error, batchId },
      "Saved batch; queue recovery will finish dispatch",
    );
  }
  return { batchId, count: rows.length, replayed: false, queuePending };
}

async function replay(
  batch: { id: string; requestHash: string },
  hash: string,
) {
  if (batch.requestHash !== hash)
    throw httpError(
      409,
      "Idempotency key was already used for a different request",
    );
  return {
    batchId: batch.id,
    count: await prisma.email.count({ where: { batchId: batch.id } }),
    replayed: true,
  };
}
