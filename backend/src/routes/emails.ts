import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../config/db.js";
import { scheduleSchema } from "../validators/schedule.js";
import { scheduleEmails } from "../services/scheduling.js";
import { searchEmails } from "../integrations/elasticsearch/search.js";
import { HttpError } from "../middleware/errors.js";
import { emailSelect } from "../services/email-select.js";
export { emailSelect } from "../services/email-select.js";
export const emailsRouter = Router();
const pagination = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
const mailbox = z.enum(["scheduled", "sent", "starred", "archive", "trash"]);
export function mailboxWhere(
  folder: z.infer<typeof mailbox>,
): Prisma.EmailWhereInput {
  if (folder === "trash") return { trashedAt: { not: null } };
  if (folder === "archive") return { archived: true, trashedAt: null };
  if (folder === "starred") return { starred: true, trashedAt: null };
  return {
    archived: false,
    trashedAt: null,
    status: {
      in:
        folder === "scheduled"
          ? ["SCHEDULED", "PROCESSING"]
          : ["SENT", "FAILED"],
    },
  };
}
emailsRouter.post("/schedule", async (req, res) => {
  const key = z
    .string()
    .min(16)
    .max(128)
    .regex(/^[A-Za-z0-9_-]+$/)
    .parse(req.get("Idempotency-Key"));
  const result = await scheduleEmails(
    req.user!.id,
    scheduleSchema.parse(req.body),
    key,
  );
  res.status(result.replayed ? 200 : 201).json({ data: result });
});
emailsRouter.get("/counts", async (req, res) => {
  const folders = mailbox.options;
  const counts = await Promise.all(
    folders.map((folder) =>
      prisma.email.count({
        where: { userId: req.user!.id, ...mailboxWhere(folder) },
      }),
    ),
  );
  res.json({
    data: Object.fromEntries(folders.map((folder, i) => [folder, counts[i]])),
  });
});
for (const path of mailbox.options) {
  emailsRouter.get(`/${path}`, async (req, res) => {
    const { page, pageSize } = pagination.parse(req.query);
    const where: Prisma.EmailWhereInput = {
      userId: req.user!.id,
      ...mailboxWhere(path),
    };
    const [items, total] = await prisma.$transaction([
      prisma.email.findMany({
        where,
        select: emailSelect,
        orderBy:
          path === "scheduled"
            ? [{ scheduledAt: "asc" }, { id: "asc" }]
            : [{ updatedAt: "desc" }, { id: "desc" }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.email.count({ where }),
    ]);
    res.json({ data: { items, total, page, pageSize } });
  });
}
emailsRouter.get("/search", async (req, res) => {
  const query = pagination
    .extend({
      q: z.string().trim().max(300).optional(),
      status: z.enum(["SCHEDULED", "PROCESSING", "SENT", "FAILED"]).optional(),
      folder: mailbox.optional(),
    })
    .parse(req.query);
  res.json({ data: await searchEmails(req.user!.id, query) });
});
emailsRouter.patch("/:id", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const changes = z
    .object({
      starred: z.boolean().optional(),
      archived: z.boolean().optional(),
      trashed: z.boolean().optional(),
    })
    .strict()
    .refine((v) => Object.keys(v).length > 0)
    .parse(req.body);
  const where: Prisma.EmailWhereInput = {
    id,
    userId: req.user!.id,
    ...(changes.trashed ? { status: { in: ["SENT", "FAILED"] } } : {}),
  };
  const changed = await prisma.email.updateMany({
    where,
    data: {
      starred: changes.starred,
      archived: changes.archived,
      trashedAt:
        changes.trashed === undefined
          ? undefined
          : changes.trashed
            ? new Date()
            : null,
    },
  });
  if (!changed.count) {
    const exists = await prisma.email.findFirst({
      where: { id, userId: req.user!.id },
      select: { id: true },
    });
    if (!exists) throw new HttpError(404, "Email not found.");
    throw new HttpError(
      409,
      "Scheduled emails cannot be moved to Trash while delivery is pending.",
    );
  }
  res.json({
    data: await prisma.email.findUnique({ where: { id }, select: emailSelect }),
  });
});
emailsRouter.get("/:id/attachments/:attachmentId", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const attachmentId = z.string().uuid().parse(req.params.attachmentId);
  const file = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      batch: { emails: { some: { id, userId: req.user!.id } } },
    },
  });
  if (!file) throw new HttpError(404, "Attachment not found.");
  res.setHeader("Content-Type", file.contentType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
  );
  res.send(Buffer.from(file.content));
});
emailsRouter.get("/:id", async (req, res) => {
  const id = z.string().uuid().parse(req.params.id);
  const email = await prisma.email.findFirst({
    where: { id, userId: req.user!.id },
    select: emailSelect,
  });
  if (!email) throw new HttpError(404, "Email not found.");
  res.json({ data: email });
});
