import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test(
  "real PostgreSQL and BullMQ persist a burst of 1000 recipients without duplicate publication",
  {
    skip: !process.env.DATABASE_TEST_URL || !process.env.REDIS_TEST_PORT,
  },
  async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_TEST_URL,
      REDIS_PORT: process.env.REDIS_TEST_PORT,
      JWT_SECRET: "load-test-only-session-secret-32-characters",
      ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
    });
    const { prisma } = await import("../src/config/db.js");
    const { redis } = await import("../src/config/redis.js");
    const { scheduleEmails } = await import("../src/services/scheduling.js");
    const { emailQueue, indexQueue, closeQueues } =
      await import("../src/queues/index.js");
    const marker = randomUUID();
    const user = await prisma.user.create({
      data: {
        googleId: marker,
        name: "Load test",
        email: `${marker}@example.com`,
      },
    });
    const sender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Load",
        email: `${marker}@ethereal.email`,
        smtpUser: "unused",
        smtpPasswordEncrypted: "no-SMTP-in-this-test",
      },
    });
    try {
      const startTime = new Date(Date.now() + 3600000).toISOString();
      const input = {
        senderId: sender.id,
        subject: "1000 recipient burst",
        body: "No SMTP requested.",
        recipients: Array.from(
          { length: 1000 },
          (_, i) => `lead${i}@example.com`,
        ),
        startTime,
        delaySeconds: 2,
        hourlyLimit: 200,
      };
      const result = await scheduleEmails(user.id, input, marker);
      assert.equal(result.count, 1000);
      assert.equal(result.queuePending, false);
      const rows = await prisma.email.findMany({
        where: { batchId: result.batchId },
        orderBy: { originalScheduledAt: "asc" },
      });
      assert.equal(rows.length, 1000);
      assert.equal(new Set(rows.map((row) => row.bullJobId)).size, 1000);
      assert.equal(
        rows.at(-1)!.scheduledAt.getTime() - rows[0]!.scheduledAt.getTime(),
        999 * 2000,
      );
      for (const row of [rows[0]!, rows[499]!, rows[500]!, rows[999]!]) {
        const job = await emailQueue.getJob(row.bullJobId);
        assert.equal(await job?.getState(), "delayed");
        assert.equal(row.attempts, 0);
      }
      const replay = await scheduleEmails(user.id, input, marker);
      assert.equal(replay.replayed, true);
      assert.equal(
        await prisma.email.count({ where: { batchId: result.batchId } }),
        1000,
      );
    } finally {
      const rows = await prisma.email.findMany({
        where: { userId: user.id },
        select: { id: true, bullJobId: true },
      });
      for (let offset = 0; offset < rows.length; offset += 100)
        await Promise.all(
          rows
            .slice(offset, offset + 100)
            .map(async (row) =>
              (await emailQueue.getJob(row.bullJobId))?.remove(),
            ),
        );
      const ids = new Set(rows.map((row) => row.id));
      const indexJobs = (
        await indexQueue.getJobs(["waiting", "delayed", "completed", "failed"])
      ).filter((job) => ids.has(job.data.emailId));
      for (let offset = 0; offset < indexJobs.length; offset += 100)
        await Promise.all(
          indexJobs.slice(offset, offset + 100).map((job) => job.remove()),
        );
      await prisma.email.deleteMany({ where: { userId: user.id } });
      await prisma.scheduleBatch.deleteMany({ where: { userId: user.id } });
      await prisma.sender.delete({ where: { id: sender.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await closeQueues();
      redis.disconnect();
      await prisma.$disconnect();
    }
  },
);
