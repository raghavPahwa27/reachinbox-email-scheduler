import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

test(
  "real Elasticsearch: indexed content, tenant isolation and mailbox mutation versions",
  {
    skip:
      !process.env.DATABASE_TEST_URL ||
      !process.env.REDIS_TEST_PORT ||
      !process.env.ELASTICSEARCH_TEST_URL,
  },
  async () => {
    Object.assign(process.env, {
      DATABASE_URL: process.env.DATABASE_TEST_URL,
      REDIS_PORT: process.env.REDIS_TEST_PORT,
      ELASTICSEARCH_URL: process.env.ELASTICSEARCH_TEST_URL,
      JWT_SECRET: "search-integration-session-secret-32-characters",
      ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
    });
    const { prisma } = await import("../src/config/db.js");
    const { redis } = await import("../src/config/redis.js");
    const { scheduleEmails } = await import("../src/services/scheduling.js");
    const { emailQueue, indexQueue, closeQueues } =
      await import("../src/queues/index.js");
    const { searchClient, EMAIL_INDEX, indexEmail, searchEmails } =
      await import("../src/integrations/elasticsearch/search.js");
    const marker = randomUUID();
    const user = await prisma.user.create({
      data: {
        googleId: marker,
        name: "Search test",
        email: `${marker}@example.com`,
      },
    });
    const sender = await prisma.sender.create({
      data: {
        userId: user.id,
        name: "Search",
        email: `${marker}@ethereal.email`,
        smtpUser: "unused",
        smtpPasswordEncrypted: "no-network-delivery",
      },
    });
    let emailId: string | undefined;
    try {
      const result = await scheduleEmails(
        user.id,
        {
          senderId: sender.id,
          subject: `Search regression ${marker}`,
          body: "Unique searchable appointment invitation",
          recipients: ["rpahwa123@example.com"],
          startTime: new Date(Date.now() + 3600000).toISOString(),
          delaySeconds: 2,
          hourlyLimit: 200,
        },
        marker,
      );
      let email = await prisma.email.findFirstOrThrow({
        where: { batchId: result.batchId },
      });
      emailId = email.id;
      await indexEmail(email.id);
      const refresh = () =>
        searchClient.indices.refresh({ index: EMAIL_INDEX });
      await refresh();
      const query = { q: marker, page: 1, pageSize: 20 };
      assert.equal((await searchEmails(user.id, query)).items[0]?.id, email.id);
      for (const q of [
        "rpahwa",
        "rp",
        "pahwa",
        "RPAHWA",
        "@example.com",
        "rpahwa123@example.com",
        "Search reg",
        "appointment inv",
        sender.email.slice(0, 8),
      ]) {
        const result = await searchEmails(user.id, {
          ...query,
          q,
          folder: "scheduled",
        });
        assert.equal(
          result.items[0]?.id,
          email.id,
          `partial search finds ${q}`,
        );
        assert.equal(
          (await searchEmails(randomUUID(), { ...query, q })).total,
          0,
          "partial address search remains tenant-scoped",
        );
      }
      for (const q of ["unmatched-address", "*", "?", "rpahwa?", "rpahwa*"]) {
        assert.equal(
          (await searchEmails(user.id, { ...query, q })).total,
          0,
          "wildcard input is literal and does not match every address",
        );
      }
      assert.equal(
        (await searchEmails(user.id, { ...query, q: "rpahwa", folder: "sent" }))
          .total,
        0,
        "address fragments do not bypass mailbox status filters",
      );
      assert.equal(
        (await searchEmails(randomUUID(), query)).total,
        0,
        "another tenant cannot find this message",
      );
      assert.equal(
        (await searchEmails(user.id, { ...query, status: "SENT" })).total,
        0,
      );

      for (const changes of [
        { starred: true },
        { archived: true },
        { trashedAt: new Date() },
      ]) {
        const before = email.searchVersion;
        email = await prisma.email.update({
          where: { id: email.id },
          data: changes,
        });
        assert.equal(
          email.searchVersion,
          before + 1,
          "every mailbox change receives a fresh index job version",
        );
        assert.equal(email.indexDirty, true);
        await indexEmail(email.id);
        await refresh();
        assert.equal(
          (await prisma.email.findUniqueOrThrow({ where: { id: email.id } }))
            .indexDirty,
          false,
        );
        const folder =
          "starred" in changes
            ? "starred"
            : "archived" in changes
              ? "archive"
              : "trash";
        assert.equal(
          (await searchEmails(user.id, { ...query, folder })).items[0]?.id,
          email.id,
        );
      }
      assert.equal(
        (await searchEmails(user.id, { ...query, folder: "scheduled" })).total,
        0,
      );
      // A stale version must not overwrite the latest mailbox state in Elasticsearch.
      await assert.rejects(
        searchClient.index({
          index: EMAIL_INDEX,
          id: email.id,
          version: 1,
          version_type: "external_gte",
          document: { userId: user.id },
        }),
        { statusCode: 409 },
      );
    } finally {
      const rows = await prisma.email.findMany({ where: { userId: user.id } });
      for (const row of rows)
        await (await emailQueue.getJob(row.bullJobId))?.remove();
      for (const job of await indexQueue.getJobs([
        "waiting",
        "delayed",
        "completed",
        "failed",
      ]))
        if (rows.some((row) => row.id === job.data.emailId)) await job.remove();
      if (emailId)
        await searchClient
          .delete({ index: EMAIL_INDEX, id: emailId, refresh: true })
          .catch(() => {});
      await prisma.email.deleteMany({ where: { userId: user.id } });
      await prisma.scheduleBatch.deleteMany({ where: { userId: user.id } });
      await prisma.sender.delete({ where: { id: sender.id } });
      await prisma.user.delete({ where: { id: user.id } });
      await closeQueues();
      redis.disconnect();
      await searchClient.close();
      await prisma.$disconnect();
    }
  },
);
