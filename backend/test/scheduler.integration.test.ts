import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";

const enabled = Boolean(
  process.env.DATABASE_TEST_URL && process.env.REDIS_TEST_PORT,
);
test(
  "real PostgreSQL + Redis: transactional scheduling, isolation, idempotency, delayed persistence and recovery",
  { skip: !enabled },
  async () => {
    process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
    process.env.REDIS_PORT = process.env.REDIS_TEST_PORT;
    process.env.REDIS_HOST = "127.0.0.1";
    process.env.JWT_SECRET ||= "integration-test-session-secret-32-characters";
    process.env.ENCRYPTION_KEY ||= randomBytes(32).toString("base64");
    process.env.MIN_DELAY_SECONDS = "0";
    const { prisma } = await import("../src/config/db.js");
    const { redis } = await import("../src/config/redis.js");
    const { scheduleEmails } = await import("../src/services/scheduling.js");
    const { emailQueue, indexQueue, slackQueue, closeQueues } =
      await import("../src/queues/index.js");
    const { reconcile } = await import("../src/services/reconcile.js");
    const { processEmail } = await import("../src/workers/email-worker.js");
    const suffix = randomUUID();
    const user = await prisma.user.create({
      data: {
        googleId: `test-${suffix}`,
        name: "Integration Test",
        email: `${suffix}@example.com`,
      },
    });
    const other = await prisma.user.create({
      data: {
        googleId: `test-other-${suffix}`,
        name: "Other User",
        email: `other-${suffix}@example.com`,
      },
    });
    const sender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Test sender",
        email: `sender-${suffix}@example.com`,
        smtpUser: "test",
        smtpPasswordEncrypted: "deliberately-invalid-ciphertext",
        hourlyLimit: 3,
        minDelaySeconds: 0,
      },
    });
    const input = {
      senderId: sender.id,
      subject: "Integration test",
      body: "No SMTP delivery is requested by this test.",
      recipients: [
        "first@example.com",
        "second@example.com",
        "first@example.com",
      ],
      startTime: new Date(Date.now() + 60000).toISOString(),
      delaySeconds: 5,
      hourlyLimit: 3,
    };
    try {
      const key = randomUUID();
      const results = await Promise.all([
        scheduleEmails(user.id, input, key),
        scheduleEmails(user.id, input, key),
      ]);
      assert.equal(results.filter((result) => result.replayed).length, 1);
      assert.equal(results[0]!.count, 2);
      assert.equal(results[0]!.batchId, results[1]!.batchId);
      await assert.rejects(
        scheduleEmails(
          user.id,
          { ...input, subject: "Different payload" },
          key,
        ),
        { statusCode: 409 },
      );
      await assert.rejects(scheduleEmails(other.id, input, randomUUID()), {
        statusCode: 404,
      });
      await assert.rejects(
        scheduleEmails(
          user.id,
          { ...input, startTime: new Date(Date.now() - 1000).toISOString() },
          randomUUID(),
        ),
        { statusCode: 400 },
      );
      const emails = await prisma.email.findMany({
        where: { batchId: results[0]!.batchId },
        orderBy: { originalScheduledAt: "asc" },
      });
      assert.equal(emails.length, 2);
      assert.equal(
        emails[1]!.scheduledAt.getTime() - emails[0]!.scheduledAt.getTime(),
        5000,
      );
      for (const email of emails)
        assert.equal(
          await (await emailQueue.getJob(email.bullJobId))!.getState(),
          "delayed",
        );
      const reconnected = new Queue("emails", {
        connection: {
          host: "127.0.0.1",
          port: Number(process.env.REDIS_TEST_PORT),
        },
      });
      assert.equal(
        await (await reconnected.getJob(emails[0]!.bullJobId))!.getState(),
        "delayed",
        "new producer connection sees persisted delayed job",
      );
      await reconnected.close();
      await (await emailQueue.getJob(emails[1]!.bullJobId))!.remove();
      await reconcile();
      assert.ok(
        await emailQueue.getJob(emails[1]!.bullJobId),
        "missing Redis job recovered from database",
      );
      await prisma.email.update({
        where: { id: emails[0]!.id },
        data: { status: "SENT", sentAt: new Date() },
      });
      await (await emailQueue.getJob(emails[0]!.bullJobId))!.remove();
      await reconcile();
      assert.equal(
        await emailQueue.getJob(emails[0]!.bullJobId),
        undefined,
        "completed emails are never recreated",
      );
      const terminalJob = await emailQueue.add(
        "test-terminal",
        { emailId: emails[0]!.id },
        { jobId: `terminal-${suffix}` },
      );
      await processEmail(terminalJob);
      assert.equal(
        (await prisma.email.findUniqueOrThrow({ where: { id: emails[0]!.id } }))
          .attempts,
        0,
        "SENT is terminal and bypasses SMTP",
      );
      await terminalJob.remove();
      // A corrupted encrypted credential fails before any network delivery. Exercise actual worker failure persistence.
      await prisma.email.update({
        where: { id: emails[1]!.id },
        data: { scheduledAt: new Date(Date.now() - 1000) },
      });
      const failedJob = await emailQueue.getJob(emails[1]!.bullJobId);
      failedJob!.opts.attempts = 1;
      await assert.rejects(processEmail(failedJob!));
      const failedEmail = await prisma.email.findUniqueOrThrow({
        where: { id: emails[1]!.id },
      });
      assert.equal(failedEmail.status, "FAILED");
      assert.equal(failedEmail.attempts, 1);
      assert.ok(failedEmail.errorMessage);
      const current = await prisma.email.findUniqueOrThrow({
        where: { id: emails[0]!.id },
      });
      assert.ok(
        current.searchVersion > emails[0]!.searchVersion,
        "database increments search revision on state changes",
      );
      assert.equal(current.indexDirty, true);
    } finally {
      const records = await prisma.email.findMany({
        where: { userId: user.id },
      });
      for (const record of records) {
        await (await emailQueue.getJob(record.bullJobId))?.remove();
        const indexed = await indexQueue.getJobs([
          "waiting",
          "delayed",
          "completed",
          "failed",
        ]);
        for (const job of indexed)
          if (job.data.emailId === record.id) await job.remove();
      }
      const notifications = await slackQueue.getJobs([
        "waiting",
        "delayed",
        "completed",
        "failed",
      ]);
      for (const job of notifications)
        if (job.data.userId === user.id) await job.remove();
      await prisma.email.deleteMany({ where: { userId: user.id } });
      await prisma.scheduleBatch.deleteMany({ where: { userId: user.id } });
      await prisma.sender.delete({ where: { id: sender.id } });
      await prisma.user.deleteMany({
        where: { id: { in: [user.id, other.id] } },
      });
      await closeQueues();
      await redis.quit();
      await prisma.$disconnect();
    }
  },
);

test(
  "real BullMQ: delayed jobs survive worker and producer replacement and execute only once",
  { skip: !process.env.REDIS_TEST_PORT },
  async () => {
    const connection = new Redis({
      host: "127.0.0.1",
      port: Number(process.env.REDIS_TEST_PORT),
      maxRetriesPerRequest: null,
    });
    const queueName = `restart-test-${randomUUID()}`;
    let queue = new Queue(queueName, { connection });
    const dueAt = Date.now() + 1200;
    let worker = new Worker(
      queueName,
      async () => {
        throw new Error("Old worker must be stopped before delivery");
      },
      { connection },
    );
    await queue.add(
      "delayed",
      { value: 42 },
      { jobId: "stable-job", delay: 1200 },
    );
    await worker.close();
    await queue.close();
    queue = new Queue(queueName, { connection });
    assert.equal(
      await (await queue.getJob("stable-job"))!.getState(),
      "delayed",
    );
    let sends = 0;
    let receivedAt = 0;
    worker = new Worker(
      queueName,
      async (job) => {
        assert.equal(job.data.value, 42);
        sends++;
        receivedAt = Date.now();
      },
      { connection },
    );
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(
          () => reject(new Error("Delayed job did not run")),
          8000,
        );
        worker.on("completed", () => {
          clearTimeout(timeout);
          resolve();
        });
        worker.on("error", reject);
      });
      assert.equal(sends, 1);
      assert.ok(receivedAt >= dueAt - 30, "no early execution");
      await worker.close();
      await queue.add("delayed", { value: 42 }, { jobId: "stable-job" });
      assert.equal(
        await (await queue.getJob("stable-job"))!.getState(),
        "completed",
        "deterministic ID prevents recreation",
      );
    } finally {
      await worker.close();
      await queue.obliterate({ force: true });
      await queue.close();
      await connection.quit();
    }
  },
);
