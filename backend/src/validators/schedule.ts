import { z } from "zod";
import { attachmentInput, cleanMailHtml } from "../utils/mail-content.js";

export const scheduleSchema = z
  .object({
    senderId: z.string().uuid(),
    subject: z
      .string()
      .trim()
      .min(1)
      .max(998)
      .refine(
        (value) => !/[\r\n]/.test(value),
        "Subject must not contain line breaks",
      ),
    body: z.string().min(1).max(100_000),
    bodyHtml: z.string().max(200_000).transform(cleanMailHtml).optional(),
    attachments: z
      .array(attachmentInput)
      .max(5)
      .refine(
        (files) =>
          files.reduce(
            (n, f) => n + Buffer.from(f.content, "base64").length,
            0,
          ) <=
          10 * 1024 * 1024,
        "Attachments must total at most 10 MB",
      )
      .optional(),
    recipients: z
      .array(z.string().trim().toLowerCase().email().max(254))
      .min(1)
      .max(10_000)
      .transform((recipients) => [...new Set(recipients)]),
    startTime: z.string().datetime({ offset: true }),
    delaySeconds: z.number().int().min(0).max(86400),
    hourlyLimit: z.number().int().min(1).max(100_000),
  })
  .strict();
export type ScheduleInput = z.infer<typeof scheduleSchema>;

export function scheduleTimes(
  startTime: string,
  count: number,
  delaySeconds: number,
): Date[] {
  const start = Date.parse(startTime);
  return Array.from(
    { length: count },
    (_, i) => new Date(start + i * delaySeconds * 1000),
  );
}
