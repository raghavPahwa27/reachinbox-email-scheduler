import test, { after, type TestContext } from "node:test";
import assert from "node:assert/strict";
import nodemailer from "nodemailer";
import type { Email, Sender } from "@prisma/client";

Object.assign(process.env, {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://unused:unused@127.0.0.1:5432/unused",
  JWT_SECRET: "delivery-unit-test-session-secret-32-characters",
  ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
});
const { prisma } = await import("../src/config/db.js");
const { sendEmail } = await import("../src/integrations/email/send.js");
const { encrypt } = await import("../src/utils/crypto.js");
const { cleanMailHtml, attachmentInput } =
  await import("../src/utils/mail-content.js");
const sender = {
  name: "Test sender",
  email: "sender@ethereal.email",
  smtpHost: "smtp.ethereal.email",
  smtpPort: 587,
  smtpUser: "test-user",
  smtpPasswordEncrypted: encrypt("test-password"),
} as Sender;
const email = {
  id: "0c601746-351c-440b-9aa5-6b2d61a01cbd",
  batchId: "test-batch",
  recipient: "recipient@example.com",
  subject: "A real message",
  body: "Plain text",
  bodyHtml: "<p>Formatted text</p>",
} as Email;

function attachments(t: TestContext) {
  const original = prisma.attachment.findMany;
  prisma.attachment.findMany = (async () => [
    {
      filename: "leads.txt",
      contentType: "text/plain",
      content: Buffer.from("hello"),
    },
  ]) as typeof original;
  t.after(() => {
    prisma.attachment.findMany = original;
  });
}
test("SMTP uses decrypted sender credentials, stable Message-ID, both body formats and persisted attachments", async (t) => {
  attachments(t);
  let message: nodemailer.SendMailOptions | undefined;
  let closed = false;
  t.mock.method(nodemailer, "createTransport", (options: any) => {
    assert.equal(options.host, "smtp.ethereal.email");
    assert.equal(options.requireTLS, true);
    assert.deepEqual(options.auth, {
      user: "test-user",
      pass: "test-password",
    });
    return {
      sendMail: async (value: nodemailer.SendMailOptions) => {
        message = value;
        return { accepted: [email.recipient], messageId: value.messageId };
      },
      close: () => {
        closed = true;
      },
    };
  });
  await sendEmail(email, sender);
  assert.equal(message?.messageId, `<${email.id}@reachinbox.local>`);
  assert.equal(message?.to, email.recipient);
  assert.equal(message?.text, email.body);
  assert.equal(message?.html, email.bodyHtml);
  assert.equal(message?.attachments?.[0].filename, "leads.txt");
  assert.equal(closed, true);
});
test("SMTP rejection is a failure and always closes the transport", async (t) => {
  attachments(t);
  let closed = false;
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: async () => ({ accepted: [] }),
    close: () => {
      closed = true;
    },
  }));
  await assert.rejects(sendEmail(email, sender), /did not accept/);
  assert.equal(closed, true);
});
test("a lost sender lease after loading attachments prevents the SMTP handoff", async (t) => {
  attachments(t);
  const send = t.mock.fn(async () => ({ accepted: [email.recipient] }));
  let closed = false;
  t.mock.method(nodemailer, "createTransport", () => ({
    sendMail: send,
    close: () => {
      closed = true;
    },
  }));
  await assert.rejects(
    sendEmail(email, sender, async () => {
      throw new Error("lease lost");
    }),
    /lease lost/,
  );
  assert.equal(send.mock.callCount(), 0);
  assert.equal(closed, true);
});
test("rich email sanitation removes executable content and attachment validation rejects path traversal", () => {
  const sanitized = cleanMailHtml(
    '<p style="text-align:center;color:red" onclick="alert(1)">Hi<strong>there</strong></p><script>alert(2)</script><a href="javascript:alert(3)">link</a>',
  );
  assert.ok(sanitized.includes("<strong>there</strong>"));
  assert.ok(sanitized.includes("text-align:center"));
  assert.ok(!/script|onclick|color:|javascript:/.test(sanitized));
  assert.equal(
    attachmentInput.safeParse({
      filename: "../secret.txt",
      contentType: "text/plain",
      content: "aGVsbG8=",
    }).success,
    false,
  );
  assert.equal(
    attachmentInput.safeParse({
      filename: "hello.txt",
      contentType: "text/plain",
      content: "aGVsbG8=",
    }).success,
    true,
  );
});
after(() => prisma.$disconnect());
