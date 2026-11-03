import test from "node:test";
import assert from "node:assert/strict";
import { googleOAuthFailureReason } from "../src/integrations/google/errors.js";

test("Google token errors produce fixed safe categories without disclosing provider payloads", () => {
  const rejected = {
    response: {
      data: {
        error: "invalid_client",
        error_description: "sensitive provider text",
      },
      config: { body: "secret" },
    },
  };
  assert.equal(
    googleOAuthFailureReason("exchange", rejected),
    "client_configuration",
  );
  assert.equal(
    googleOAuthFailureReason("exchange", {
      response: { data: { error: "invalid_grant" } },
    }),
    "authorization_expired",
  );
  assert.equal(
    googleOAuthFailureReason("exchange", {
      response: { data: { error: "redirect_uri_mismatch" } },
    }),
    "redirect_configuration",
  );
  assert.equal(
    googleOAuthFailureReason("exchange", {
      response: { data: { error: "sensitive unrecognized value" } },
    }),
    "provider_error",
  );
  assert.equal(googleOAuthFailureReason("exchange", null), "provider_error");
});
test("Google callback stages distinguish missing sessions, consent denial and database failures", () => {
  assert.equal(
    googleOAuthFailureReason("state", new Error("secret")),
    "session_expired",
  );
  assert.equal(
    googleOAuthFailureReason("provider", "access_denied"),
    "cancelled",
  );
  assert.equal(
    googleOAuthFailureReason(
      "database",
      new Error("sensitive connection data"),
    ),
    "storage_unavailable",
  );
  assert.equal(
    googleOAuthFailureReason("verify", new Error("token")),
    "profile_invalid",
  );
});
