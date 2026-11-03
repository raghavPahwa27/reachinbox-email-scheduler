import nodemailer from "nodemailer";
import type { Email, Sender } from "@prisma/client";
import { env } from "../../config/env.js";
import { decrypt } from "../../utils/crypto.js";
import { logger } from "../../utils/logger.js";
import { prisma } from "../../config/db.js";

export async function sendEmail(
  email: Email,
  sender: Sender,
  beforeSend?: () => Promise<void>,
): Promise<string | null> {
  // New bounded transport per attempt makes cancellation and sender credentials explicit.
  const transport = nodemailer.createTransport({
    host: sender.smtpHost,
    port: sender.smtpPort,
    secure: sender.smtpPort === 465,
    requireTLS: sender.smtpPort !== 465,
    auth: {
      user: sender.smtpUser,
      pass: decrypt(sender.smtpPasswordEncrypted),
    },
    connectionTimeout: env.SMTP_TIMEOUT_MS,
    greetingTimeout: env.SMTP_TIMEOUT_MS,
    socketTimeout: env.SMTP_TIMEOUT_MS,
  });
  let timer: NodeJS.Timeout | undefined;
  try {
    const attachments = await prisma.attachment.findMany({
      where: { batchId: email.batchId },
    });
    // Database access can take longer than a sender lease during an outage.
    // The worker fences the actual SMTP handoff after that access completes.
    await beforeSend?.();
    const delivery = transport.sendMail({
      from: { name: sender.name, address: sender.email },
      to: email.recipient,
      subject: email.subject,
      text: email.body,
      html: email.bodyHtml || undefined,
      attachments: attachments.map((file) => ({
        filename: file.filename,
        contentType: file.contentType,
        content: Buffer.from(file.content),
      })),
      // Stable Message-ID helps downstream deduplication; SMTP still does not guarantee exactly once.
      messageId: `<${email.id}@reachinbox.local>`,
      headers: { "X-ReachInbox-Email-ID": email.id },
    });
    const result = await Promise.race([
      delivery,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          transport.close();
          reject(
            new Error("SMTP attempt timed out; delivery may be ambiguous"),
          );
        }, env.SMTP_TIMEOUT_MS);
      }),
    ]);
    if (result.accepted.length === 0)
      throw new Error("SMTP did not accept the recipient");
    const previewUrl = nodemailer.getTestMessageUrl(result) || null;
    logger.info(
      { emailId: email.id, messageId: result.messageId, previewUrl },
      "SMTP accepted email",
    );
    return previewUrl;
  } finally {
    if (timer) clearTimeout(timer);
    transport.close();
  }
}
