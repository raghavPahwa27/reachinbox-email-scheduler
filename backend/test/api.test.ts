import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import express from "express";
import request from "supertest";
import { OAuth2Client } from "google-auth-library";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL ??= "postgresql://test:test@127.0.0.1:5432/test";
process.env.JWT_SECRET ??= "test-secret-never-use-in-production-1234567890";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.GOOGLE_CLIENT_ID = "unit-test.apps.googleusercontent.com";
process.env.GOOGLE_CLIENT_SECRET = "unit-test-not-a-real-secret";
const { prisma } = await import("../src/config/db.js");
const {
  requireCsrf,
  requireAuth,
  requireAdmin,
  safeEqual,
  requireBoardOrigin,
} = await import("../src/middleware/auth.js");
const { errorHandler } = await import("../src/middleware/errors.js");
const { sendersRouter } = await import("../src/routes/senders.js");
const { authRouter } = await import("../src/routes/auth.js");
const { slackRouter } = await import("../src/routes/slack.js");
const userId = "f5621fdc-e69b-46fc-95ec-a9ce52c81f8f";
const senderId = "b065793a-47cf-45fa-b134-635319072c49";

// Prisma delegates expose functions through a Proxy rather than own property descriptors.
function stubMethod(
  t: TestContext,
  delegate: object,
  method: string,
  fn: (...args: any[]) => any,
) {
  const target = delegate as Record<string, unknown>;
  const original = target[method];
  const stub = t.mock.fn(fn);
  target[method] = stub;
  t.after(() => {
    target[method] = original;
  });
  return stub;
}

function testApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.session = {
      csrfToken: "expected-token",
      save: (callback: (error?: Error) => void) => callback(),
    } as unknown as typeof req.session;
    req.user = {
      id: userId,
      email: "owner@example.com",
      googleId: "google-id",
      name: "Owner",
      avatar: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    next();
  });
  return app;
}

test("CSRF comparison rejects absent and different-length values", () => {
  assert.equal(safeEqual(undefined, undefined), false);
  assert.equal(safeEqual("a", "aa"), false);
  assert.equal(safeEqual("same", "same"), true);
});
test("mutations require CSRF but reads remain available", async () => {
  const app = testApp();
  app.use(requireCsrf);
  app.all("/check", (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  assert.equal((await request(app).get("/check")).status, 200);
  assert.equal((await request(app).post("/check")).status, 403);
  assert.equal(
    (await request(app).post("/check").set("X-CSRF-Token", "wrong")).status,
    403,
  );
  assert.equal(
    (await request(app).post("/check").set("X-CSRF-Token", "expected-token"))
      .status,
    200,
  );
});
test("missing session and non-admin user cannot reach protected resources", async () => {
  const app = testApp();
  app.get("/private", requireAuth, (_req, res) => res.sendStatus(200));
  app.get("/admin", requireAdmin, (_req, res) => res.sendStatus(200));
  app.use(errorHandler);
  assert.equal((await request(app).get("/private")).status, 401);
  assert.equal((await request(app).get("/admin")).status, 403);
});
test("queue mutations reject foreign and absent Origins", async () => {
  const app = testApp();
  app.post("/queue", requireBoardOrigin, (_req, res) => res.sendStatus(200));
  app.use(errorHandler);
  assert.equal((await request(app).post("/queue")).status, 403);
  assert.equal(
    (
      await request(app)
        .post("/queue")
        .set("Origin", "https://attacker.example")
    ).status,
    403,
  );
  assert.equal(
    (await request(app).post("/queue").set("Origin", "http://localhost:5173"))
      .status,
    200,
  );
});
test("sender validation rejects a user-controlled SMTP host before database access", async () => {
  const app = testApp();
  app.use("/senders", sendersRouter);
  app.use(errorHandler);
  const response = await request(app).post("/senders").send({
    name: "Sender",
    email: "sender@example.com",
    smtpHost: "127.0.0.1",
    hourlyLimit: 10,
    minDelaySeconds: 2,
  });
  assert.equal(response.status, 400);
});
test("sender reads and mutations scope database queries to authenticated user", async (t) => {
  // Unit boundary stub: verifies query construction; PostgreSQL integration tests
  // separately exercise persistence. Production code always uses Prisma.
  const findMany = stubMethod(
    t,
    prisma.sender,
    "findMany",
    async (args: unknown) => {
      assert.deepEqual((args as { where: unknown }).where, { userId });
      return [];
    },
  );
  const findFirst = stubMethod(
    t,
    prisma.sender,
    "findFirst",
    async (args: unknown) => {
      assert.deepEqual((args as { where: unknown }).where, {
        id: senderId,
        userId,
      });
      return null;
    },
  );
  const app = testApp();
  app.use("/senders", sendersRouter);
  app.use(errorHandler);
  assert.equal((await request(app).get("/senders")).status, 200);
  assert.equal(
    (
      await request(app)
        .patch(`/senders/${senderId}`)
        .send({ name: "Stolen sender" })
    ).status,
    404,
  );
  assert.equal((await request(app).delete(`/senders/${senderId}`)).status, 404);
  assert.equal(findMany.mock.callCount(), 1);
  assert.equal(findFirst.mock.callCount(), 2);
});
test("OAuth callbacks reject missing state without exchanging a code", async () => {
  const app = testApp();
  app.use("/auth", authRouter);
  app.use("/slack", slackRouter);
  app.use(errorHandler);
  const google = await request(app).get(
    "/auth/google/callback?code=untrusted&state=untrusted",
  );
  assert.equal(google.status, 302);
  assert.equal(
    google.headers.location,
    "http://localhost:5173/login?oauthError=google&reason=session_expired",
  );
  const slack = await request(app).get(
    "/slack/callback?code=untrusted&state=untrusted",
  );
  assert.equal(slack.status, 302);
  assert.equal(
    slack.headers.location,
    "http://localhost:5173/dashboard?oauthError=slack&slackError=invalid_oauth_state",
  );
});
test("Slack status selects only public connection metadata for current user", async (t) => {
  stubMethod(
    t,
    prisma.slackIntegration,
    "findUnique",
    async (args: unknown) => {
      assert.deepEqual(args, {
        where: { userId },
        select: { teamName: true, channelId: true, connectedAt: true },
      });
      return {
        teamName: "Test workspace",
        channelId: "C123",
        connectedAt: new Date("2026-01-01"),
      };
    },
  );
  const app = testApp();
  app.use("/slack", slackRouter);
  app.use(errorHandler);
  const response = await request(app).get("/slack/status");
  assert.equal(response.status, 200);
  assert.equal(response.body.data.connected, true);
  assert.equal(response.body.data.accessTokenEncrypted, undefined);
});
test("Google callback reports rejected client credentials without leaking the provider response", async (t) => {
  const exchange = t.mock.method(
    OAuth2Client.prototype,
    "getToken",
    async () => {
      throw Object.assign(new Error("sensitive request details"), {
        response: {
          data: { error: "invalid_client", error_description: "private data" },
        },
      });
    },
  );
  const app = testApp();
  app.use((req, _res, next) => {
    req.session.googleOAuth = {
      state: "expected-state",
      nonce: "test-nonce",
      verifier: "test-verifier",
      expiresAt: Date.now() + 60000,
    };
    next();
  });
  app.use("/auth", authRouter);
  app.use(errorHandler);
  const response = await request(app).get(
    "/auth/google/callback?code=test-code&state=expected-state",
  );
  assert.equal(response.status, 302);
  assert.equal(
    response.headers.location,
    "http://localhost:5173/login?oauthError=google&reason=client_configuration",
  );
  assert.equal(exchange.mock.callCount(), 1);
  assert.ok(!JSON.stringify(response.body).includes("private data"));
});
after(async () => {
  const { redis } = await import("../src/config/redis.js");
  redis.disconnect();
  await prisma.$disconnect();
});
