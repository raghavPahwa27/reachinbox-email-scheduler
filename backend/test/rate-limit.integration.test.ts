import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Redis } from "ioredis";
import {
  reserveSend,
  releaseSender,
  leaseKey,
  SLACK_OUTBOX,
} from "../src/services/rate-limit.js";

const port = Number(process.env.REDIS_TEST_PORT);
const enabled = Number.isInteger(port) && port > 0;
test(
  "real Redis: distributed sender leases, atomic hourly admission, retry accounting and Slack dedupe",
  { skip: !enabled },
  async () => {
    const clients = Array.from(
      { length: 8 },
      () => new Redis({ host: "127.0.0.1", port, maxRetriesPerRequest: 1 }),
    );
    const senderId = `test-${randomUUID()}`;
    const token = randomUUID();
    try {
      const locks = await Promise.all(
        clients.map((client, index) =>
          client.set(
            leaseKey(senderId),
            `${token}-${index}`,
            "PX",
            10000,
            "NX",
          ),
        ),
      );
      assert.equal(
        locks.filter(Boolean).length,
        1,
        "only one worker holds sender lease",
      );
      const owner = locks.findIndex(Boolean);
      const ownedToken = `${token}-${owner}`;
      const base = {
        senderId,
        userId: "test-user",
        senderEmail: "test@example.com",
        token: ownedToken,
        delayMs: 0,
        limit: 3,
      };
      const first = await reserveSend(clients[owner]!, {
        ...base,
        attemptId: `${senderId}-1`,
      });
      assert.equal(first.allowed, true);
      const retry = await reserveSend(clients[owner]!, {
        ...base,
        attemptId: `${senderId}-1`,
      });
      assert.equal(
        retry.count,
        1,
        "same reservation does not consume two slots",
      );
      const results = await Promise.all(
        clients.map((client, index) =>
          reserveSend(client, {
            ...base,
            attemptId: `${senderId}-${index + 2}`,
          }),
        ),
      );
      assert.equal(
        results.filter((result) => result.allowed).length,
        2,
        "concurrent admissions stop exactly at the limit",
      );
      const blocked = results.find((result) => !result.allowed)!;
      assert.equal(blocked.count, 3);
      assert.equal(
        blocked.nextAvailable,
        (blocked.window + 1) * 3600000,
        "blocked job is deferred to the next UTC hour",
      );
      const events = await clients[0]!.hgetall(SLACK_OUTBOX);
      assert.equal(
        Object.keys(events).filter((key) => key.startsWith(senderId)).length,
        1,
        "one notification event per sender/hour",
      );
      assert.equal(
        await releaseSender(clients[0]!, senderId, "wrong-token", 0),
        0,
        "other worker cannot unlock sender",
      );
      assert.equal(
        await releaseSender(clients[owner]!, senderId, ownedToken, 0),
        1,
      );
    } finally {
      const keys = await clients[0]!.keys(`*${senderId}*`);
      if (keys.length) await clients[0]!.del(...keys);
      const events = Object.keys(
        await clients[0]!.hgetall(SLACK_OUTBOX),
      ).filter((key) => key.startsWith(senderId));
      if (events.length) await clients[0]!.hdel(SLACK_OUTBOX, ...events);
      await Promise.all(clients.map((client) => client.quit()));
    }
  },
);
test(
  "real Redis: minimum spacing survives different worker connections",
  { skip: !enabled },
  async () => {
    const first = new Redis({
      host: "127.0.0.1",
      port,
      maxRetriesPerRequest: 1,
    });
    const second = new Redis({
      host: "127.0.0.1",
      port,
      maxRetriesPerRequest: 1,
    });
    const senderId = `test-${randomUUID()}`;
    try {
      await first.set(leaseKey(senderId), "one", "PX", 10000);
      const base = {
        senderId,
        userId: "test-user",
        senderEmail: "test@example.com",
        delayMs: 2000,
        limit: 10,
      };
      assert.equal(
        (
          await reserveSend(first, {
            ...base,
            token: "one",
            attemptId: `${senderId}-one`,
          })
        ).allowed,
        true,
      );
      await releaseSender(first, senderId, "one", 2000);
      await second.set(leaseKey(senderId), "two", "PX", 10000);
      const blocked = await reserveSend(second, {
        ...base,
        token: "two",
        attemptId: `${senderId}-two`,
      });
      assert.equal(blocked.allowed, false);
      assert.equal(
        blocked.count,
        1,
        "deferral does not consume another hourly slot",
      );
      assert.ok(blocked.nextAvailable >= Date.now() + 1500);
      const stale = await reserveSend(first, {
        ...base,
        token: "one",
        attemptId: `${senderId}-stale`,
      });
      assert.equal(stale.leaseLost, true, "expired owner cannot send");
    } finally {
      const keys = await first.keys(`*${senderId}*`);
      if (keys.length) await first.del(...keys);
      await Promise.all([first.quit(), second.quit()]);
    }
  },
);
