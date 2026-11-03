import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import express from "express";
import request from "supertest";

test(
  "real PostgreSQL and Redis API integration",
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.REDIS_PORT = process.env.TEST_REDIS_PORT ?? "16379";
    process.env.REDIS_HOST = process.env.TEST_REDIS_HOST ?? "127.0.0.1";
    process.env.JWT_SECRET ??= "integration-test-secret-32-characters-minimum";
    process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 9).toString("base64");
    const { prisma } = await import("../src/config/db.js");
    const { redis } = await import("../src/config/redis.js");
    const { emailQueue, indexQueue, closeQueues } =
      await import("../src/queues/index.js");
    const { emailsRouter } = await import("../src/routes/emails.js");
    const { sendersRouter } = await import("../src/routes/senders.js");
    const { requireAuth, requireCsrf } =
      await import("../src/middleware/auth.js");
    const { errorHandler } = await import("../src/middleware/errors.js");
    const { searchClient } =
      await import("../src/integrations/elasticsearch/search.js");
    const { encrypt } = await import("../src/utils/crypto.js");
    const marker = randomUUID();
    const users = await Promise.all(
      ["a", "b"].map((suffix) =>
        prisma.user.create({
          data: {
            googleId: `api-test-${marker}-${suffix}`,
            name: `API test ${suffix}`,
            email: `${marker}-${suffix}@example.com`,
          },
        }),
      ),
    );
    const [owner, foreign] = users;
    assert.ok(owner && foreign);
    const sender = await prisma.sender.create({
      data: {
        userId: owner.id,
        name: "Test sender",
        email: `${marker}@example.com`,
        smtpUser: "integration-no-delivery",
        smtpPasswordEncrypted: encrypt("integration-test-only"),
        hourlyLimit: 200,
        minDelaySeconds: 2,
      },
    });
    const app = express();
    app.use(express.json());
    // Authentication-provider boundary only: all ownership checks below run the real
    // requireAuth against PostgreSQL. This header is never installed in production.
    app.use((req, _res, next) => {
      const userId = req.get("X-Test-User");
      req.session = {
        ...(userId ? { userId } : {}),
        csrfToken: "integration-csrf",
      } as typeof req.session;
      next();
    });
    app.use("/api", requireCsrf, requireAuth);
    app.use("/api/emails", emailsRouter);
    app.use("/api/senders", sendersRouter);
    app.use(errorHandler);
    const payload = {
      senderId: sender.id,
      subject: "API integration message",
      body: "Persisted message body",
      recipients: ["first@example.com", "second@example.com"],
      startTime: new Date(Date.now() + 3600_000).toISOString(),
      delaySeconds: 5,
      hourlyLimit: 20,
    };
    const key = randomUUID();
    const schedule = (body: unknown, identity = owner.id, idempotency = key) =>
      request(app)
        .post("/api/emails/schedule")
        .set("X-Test-User", identity)
        .set("X-CSRF-Token", "integration-csrf")
        .set("Idempotency-Key", idempotency)
        .send(body);
    let batchId: string | undefined;
    try {
      await t.test(
        "stores scheduled recipients and creates genuine delayed BullMQ jobs",
        async () => {
          const result = await schedule(payload);
          assert.equal(result.status, 201, JSON.stringify(result.body));
          assert.equal(result.body.data.count, 2);
          assert.equal(result.body.data.queuePending, false);
          batchId = result.body.data.batchId;
          const rows = await prisma.email.findMany({
            where: { batchId },
            orderBy: { scheduledAt: "asc" },
          });
          assert.equal(rows.length, 2);
          assert.equal(rows[0]!.status, "SCHEDULED");
          assert.equal(
            rows[1]!.scheduledAt.getTime() - rows[0]!.scheduledAt.getTime(),
            5000,
          );
          for (const row of rows) {
            const job = await emailQueue.getJob(row.bullJobId);
            assert.ok(job);
            assert.equal(await job.getState(), "delayed");
            assert.equal(job.data.emailId, row.id);
          }
        },
      );
      await t.test(
        "duplicate HTTP request replays once and changed payload conflicts",
        async () => {
          const duplicate = await schedule(payload);
          assert.equal(duplicate.status, 200);
          assert.equal(duplicate.body.data.replayed, true);
          assert.equal(duplicate.body.data.batchId, batchId);
          assert.equal(await prisma.email.count({ where: { batchId } }), 2);
          const conflict = await schedule({
            ...payload,
            subject: "Changed subject",
          });
          assert.equal(conflict.status, 409);
          assert.equal(await prisma.email.count({ where: { batchId } }), 2);
        },
      );
      await t.test(
        "foreign user cannot schedule from sender, read email, or list owner emails",
        async () => {
          const row = await prisma.email.findFirstOrThrow({
            where: { batchId },
          });
          assert.equal(
            (await schedule(payload, foreign.id, randomUUID())).status,
            404,
          );
          assert.equal(
            (
              await request(app)
                .get(`/api/emails/${row.id}`)
                .set("X-Test-User", foreign.id)
            ).status,
            404,
          );
          const foreignList = await request(app)
            .get("/api/emails/scheduled")
            .set("X-Test-User", foreign.id);
          assert.equal(foreignList.status, 200);
          assert.equal(foreignList.body.data.total, 0);
          const ownList = await request(app)
            .get("/api/emails/scheduled?pageSize=1")
            .set("X-Test-User", owner.id);
          assert.equal(ownList.body.data.total, 2);
          assert.equal(ownList.body.data.items.length, 1);
          assert.equal(
            (await request(app).get("/api/emails/scheduled")).status,
            401,
          );
        },
      );
      await t.test(
        "sender API omits credentials and preserves referenced history",
        async () => {
          const result = await request(app)
            .get("/api/senders")
            .set("X-Test-User", owner.id);
          assert.equal(result.status, 200);
          assert.equal(result.body.data[0].smtpPasswordEncrypted, undefined);
          assert.equal(result.body.data[0].smtpUser, undefined);
          const ownDelete = await request(app)
            .delete(`/api/senders/${sender.id}`)
            .set("X-Test-User", owner.id)
            .set("X-CSRF-Token", "integration-csrf");
          assert.equal(ownDelete.status, 409);
          const foreignPatch = await request(app)
            .patch(`/api/senders/${sender.id}`)
            .set("X-Test-User", foreign.id)
            .set("X-CSRF-Token", "integration-csrf")
            .send({ name: "Unauthorized" });
          assert.equal(foreignPatch.status, 404);
          assert.equal(
            (
              await prisma.sender.findUniqueOrThrow({
                where: { id: sender.id },
              })
            ).name,
            "Test sender",
          );
        },
      );
      await t.test(
        "invalid recipients and past schedules do not persist batches",
        async () => {
          assert.equal(
            (
              await schedule(
                { ...payload, recipients: ["not-an-email"] },
                owner.id,
                randomUUID(),
              )
            ).status,
            400,
          );
          assert.equal(
            (
              await schedule(
                {
                  ...payload,
                  startTime: new Date(Date.now() - 1000).toISOString(),
                },
                owner.id,
                randomUUID(),
              )
            ).status,
            400,
          );
          assert.equal(
            await prisma.scheduleBatch.count({ where: { userId: owner.id } }),
            1,
          );
        },
      );
    } finally {
      const rows = await prisma.email.findMany({
        where: { userId: { in: users.map((user) => user.id) } },
      });
      for (const row of rows) {
        await (await emailQueue.getJob(row.bullJobId))?.remove();
        await (
          await indexQueue.getJob(`index-${row.id}-${row.searchVersion}`)
        )?.remove();
      }
      await prisma.email.deleteMany({
        where: { userId: { in: users.map((user) => user.id) } },
      });
      await prisma.scheduleBatch.deleteMany({
        where: { userId: { in: users.map((user) => user.id) } },
      });
      await prisma.sender.deleteMany({
        where: { userId: { in: users.map((user) => user.id) } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: users.map((user) => user.id) } },
      });
      await closeQueues();
      await searchClient.close();
      await redis.quit();
      await prisma.$disconnect();
    }
  },
);
