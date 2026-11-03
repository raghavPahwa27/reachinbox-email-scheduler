import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

test(
  "real worker defers an exhausted sender, persists next window and consumes no SMTP attempt",
  { skip: !process.env.DATABASE_TEST_URL || !process.env.REDIS_TEST_PORT },
  async () => {
    process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
    process.env.REDIS_PORT = process.env.REDIS_TEST_PORT;
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.JWT_SECRET = "test-session-secret-for-worker-integration";
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const { prisma } = await import("../src/config/db.js");
    const { redis } = await import("../src/config/redis.js");
    const { scheduleEmails } = await import("../src/services/scheduling.js");
    const { processEmail } = await import("../src/workers/email-worker.js");
    const { emailQueue, indexQueue, closeQueues } =
      await import("../src/queues/index.js");
    const marker = randomUUID();
    const user = await prisma.user.create({
      data: {
        googleId: marker,
        name: "Worker test",
        email: `${marker}@example.com`,
      },
    });
    const sender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Worker test",
        email: `sender-${marker}@example.com`,
        smtpUser: "unused",
        smtpPasswordEncrypted: "invalid-no-SMTP-allowed",
        hourlyLimit: 1,
        minDelaySeconds: 2,
      },
    });
    const connection = new Redis({
      port: Number(process.env.REDIS_TEST_PORT),
      host: "127.0.0.1",
      maxRetriesPerRequest: null,
    });
    const queue = new Queue(`worker-test-${marker}`, { connection });
    let worker: Worker | undefined;
    try {
      const result = await scheduleEmails(
        user.id,
        {
          senderId: sender.id,
          subject: "Throttle",
          body: "Test only",
          recipients: ["test@example.com"],
          startTime: new Date(Date.now() + 60000).toISOString(),
          delaySeconds: 2,
          hourlyLimit: 1,
        },
        marker,
      );
      const email = await prisma.email.findFirstOrThrow({
        where: { batchId: result.batchId },
      });
      await (await emailQueue.getJob(email.bullJobId))!.remove();
      await prisma.email.update({
        where: { id: email.id },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      const [seconds] = await connection.time();
      const window = Math.floor(Number(seconds) / 3600);
      await connection.set(
        `reachinbox:sender:${sender.id}:hour:${window}`,
        "1",
        "EX",
        7200,
      );
      const job = await queue.add(
        "send",
        { emailId: email.id },
        { jobId: `test-${marker}`, attempts: 5 },
      );
      worker = new Worker(queue.name, processEmail, { connection });
      const deadline = Date.now() + 5000;
      while ((await job.getState()) !== "delayed") {
        if (Date.now() > deadline)
          throw new Error("Worker did not defer exhausted sender");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      const updated = await prisma.email.findUniqueOrThrow({
        where: { id: email.id },
      });
      assert.equal(updated.status, "SCHEDULED");
      assert.equal(updated.attempts, 0);
      assert.equal(updated.scheduledAt.getTime(), (window + 1) * 3600000);
      assert.equal((await queue.getJob(job.id!))!.attemptsMade, 0);
      assert.equal(
        await connection.get(`reachinbox:sender:${sender.id}:hour:${window}`),
        "1",
      );
    } finally {
      await worker?.close();
      await queue.obliterate({ force: true });
      await queue.close();
      for (const job of await indexQueue.getJobs([
        "waiting",
        "delayed",
        "completed",
        "failed",
      ])) {
        const row = await prisma.email.findFirst({
          where: { id: job.data.emailId, userId: user.id },
        });
        if (row) await job.remove();
      }
      await prisma.email.deleteMany({ where: { userId: user.id } });
      await prisma.scheduleBatch.deleteMany({ where: { userId: user.id } });
      await prisma.sender.delete({ where: { id: sender.id } });
      await prisma.user.delete({ where: { id: user.id } });
      const keys = await connection.keys(`reachinbox:sender:${sender.id}:*`);
      if (keys.length) await connection.del(...keys);
      await connection.quit();
      await closeQueues();
      await redis.quit();
      await prisma.$disconnect();
    }
  },
);
