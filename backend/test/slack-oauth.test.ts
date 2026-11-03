import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import request from "supertest";
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:5432/unused";
process.env.JWT_SECRET = "unit-test-session-secret-not-for-production";
process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("base64");
process.env.SLACK_CLIENT_ID = "unit-test-client";
process.env.SLACK_CLIENT_SECRET = "unit-test-secret";
process.env.SLACK_REDIRECT_URI = "http://localhost:3001/api/slack/callback";
process.env.FRONTEND_URL = "http://localhost:5173";
const { slackRouter } = await import("../src/routes/slack.js");
const { errorHandler } = await import("../src/middleware/errors.js");
const { prisma } = await import("../src/config/db.js");
const { decrypt } = await import("../src/utils/crypto.js");
const { safeSlackErrorCode } =
  await import("../src/integrations/slack/errors.js");
const owner = "f5621fdc-e69b-46fc-95ec-a9ce52c81f8f";
function fixture() {
  const session: Record<string, any> = {
    save: (done: (error?: Error) => void) => done(),
  };
  const app = express();
  app.use((req, _res, next) => {
    req.session = session as typeof req.session;
    req.user = { id: owner } as typeof req.user;
    next();
  });
  app.use("/slack", slackRouter);
  app.use(errorHandler);
  return { app, session };
}
async function begin(f: ReturnType<typeof fixture>) {
  const r = await request(f.app).get("/slack/connect?channelId=C12345678");
  assert.equal(r.status, 302);
  return new URL(r.headers.location);
}
async function callback(f: ReturnType<typeof fixture>, state: string) {
  return request(f.app)
    .get("/slack/callback")
    .query({ state, code: "unit-test-authorization-code" });
}
function stubUpsert(t: TestContext, inspect: (args: any) => void) {
  const original = prisma.slackIntegration.upsert;
  const stub = t.mock.fn(async (args: any) => {
    inspect(args);
    return { id: "unit-test" };
  });
  prisma.slackIntegration.upsert = stub as typeof original;
  t.after(() => {
    prisma.slackIntegration.upsert = original;
  });
  return stub;
}
const success = {
  ok: true,
  access_token: "unit-test-bot-token",
  token_type: "bot",
  scope: "chat:write",
  team: { id: "T12345678", name: "Unit workspace" },
  authed_user: { access_token: "unit-test-user-token" },
};

test("Slack initiation requests only chat:write and binds random state, channel, user and exact redirect URI", async () => {
  const f = fixture();
  const first = await begin(f);
  const second = await begin(f);
  assert.equal(first.origin, "https://slack.com");
  assert.equal(first.searchParams.get("scope"), "chat:write");
  assert.notEqual(
    first.searchParams.get("state"),
    second.searchParams.get("state"),
  );
  assert.equal(
    Buffer.from(second.searchParams.get("state")!, "base64url").length,
    32,
  );
  assert.equal(f.session.slackOAuth.userId, owner);
  assert.equal(f.session.slackOAuth.channelId, "C12345678");
  assert.equal(
    f.session.slackOAuth.redirectUri,
    second.searchParams.get("redirect_uri"),
  );
  assert.equal(
    f.session.slackOAuth.redirectUri,
    process.env.SLACK_REDIRECT_URI,
  );
  assert.ok(f.session.slackOAuth.expiresAt > Date.now() + 590000);
});
test("successful callback uses the identical redirect URI and encrypts the bot token for the Google-authenticated user without webhook fields", async (t) => {
  const f = fixture();
  const url = await begin(f);
  const post = t.mock.method(
    globalThis,
    "fetch",
    async (input: any, init: any) => {
      assert.equal(input, "https://slack.com/api/oauth.v2.access");
      assert.equal(
        init.body.get("redirect_uri"),
        url.searchParams.get("redirect_uri"),
      );
      assert.equal(init.body.get("code"), "unit-test-authorization-code");
      assert.equal(
        init.headers.Authorization,
        "Basic " +
          Buffer.from("unit-test-client:unit-test-secret").toString("base64"),
      );
      return new Response(JSON.stringify(success));
    },
  );
  const write = stubUpsert(t, (args) => {
    assert.deepEqual(args.where, { userId: owner });
    assert.equal(args.create.userId, owner);
    assert.equal(args.create.teamId, "T12345678");
    assert.equal(args.create.teamName, "Unit workspace");
    assert.equal(args.create.channelId, "C12345678");
    assert.notEqual(args.create.accessTokenEncrypted, success.access_token);
    assert.equal(
      decrypt(args.create.accessTokenEncrypted),
      success.access_token,
    );
    assert.equal(
      args.update.accessTokenEncrypted,
      args.create.accessTokenEncrypted,
    );
  });
  const r = await callback(f, url.searchParams.get("state")!);
  assert.equal(
    r.headers.location,
    "http://localhost:5173/dashboard?slack=connected",
  );
  assert.equal(post.mock.callCount(), 1);
  assert.equal(write.mock.callCount(), 1);
  assert.equal(f.session.slackOAuth, undefined);
});
test("missing, expired, mismatched and foreign-user OAuth state never reaches token exchange", async (t) => {
  const exchange = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not exchange");
  });
  for (const kind of ["missing", "expired", "mismatch", "foreign"]) {
    const f = fixture();
    const url = await begin(f);
    let state = url.searchParams.get("state")!;
    if (kind === "missing") delete f.session.slackOAuth;
    if (kind === "expired") f.session.slackOAuth.expiresAt = Date.now() - 1;
    if (kind === "mismatch") state = "wrong-state";
    if (kind === "foreign") f.session.slackOAuth.userId = "different-user";
    const r = await callback(f, state);
    assert.equal(
      new URL(r.headers.location).searchParams.get("slackError"),
      "invalid_oauth_state",
    );
  }
  assert.equal(exchange.mock.callCount(), 0);
});
test("Slack HTTP 200 ok:false exposes the exact safe provider code and does not write tokens", async (t) => {
  const f = fixture();
  const url = await begin(f);
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          ok: false,
          error: "bad_client_secret",
          error_description: "private token details",
        }),
      ),
  );
  const write = stubUpsert(t, () => {
    throw new Error("must not persist");
  });
  const r = await callback(f, url.searchParams.get("state")!);
  assert.equal(
    new URL(r.headers.location).searchParams.get("slackError"),
    "bad_client_secret",
  );
  assert.ok(!r.text.includes("private token"));
  assert.equal(write.mock.callCount(), 0);
});
test("user-token-only responses and missing chat:write scope are rejected", async (t) => {
  for (const [body, expected] of [
    [
      { ok: true, authed_user: { access_token: "private-user-token" } },
      "invalid_token_response",
    ],
    [{ ...success, scope: "incoming-webhook" }, "missing_scope"],
  ] as const) {
    const f = fixture();
    const url = await begin(f);
    const mock = t.mock.method(
      globalThis,
      "fetch",
      async () => new Response(JSON.stringify(body)),
    );
    const r = await callback(f, url.searchParams.get("state")!);
    assert.equal(
      new URL(r.headers.location).searchParams.get("slackError"),
      expected,
    );
    mock.mock.restore();
  }
});
test("provider denial is reported only after state validation and unknown payloads are never logged verbatim", async (t) => {
  const f = fixture();
  const url = await begin(f);
  const exchange = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("must not exchange");
  });
  const r = await request(f.app)
    .get("/slack/callback")
    .query({ state: url.searchParams.get("state"), error: "access_denied" });
  assert.equal(
    new URL(r.headers.location).searchParams.get("slackError"),
    "access_denied",
  );
  assert.equal(exchange.mock.callCount(), 0);
  assert.equal(safeSlackErrorCode("xoxb-secret"), "unknown_slack_error");
  assert.equal(
    safeSlackErrorCode({ access_token: "secret" }),
    "unknown_slack_error",
  );
});
after(async () => {
  const { redis } = await import("../src/config/redis.js");
  redis.disconnect();
  await prisma.$disconnect();
});
