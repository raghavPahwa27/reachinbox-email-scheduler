import { Router } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/db.js";
import { env } from "../config/env.js";
import { encrypt } from "../utils/crypto.js";
import { HttpError } from "../middleware/errors.js";

export const sendersRouter = Router();
const safeSender = {
  id: true,
  email: true,
  name: true,
  smtpHost: true,
  smtpPort: true,
  hourlyLimit: true,
  minDelaySeconds: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.SenderSelect;
const idSchema = z.string().uuid();
const senderFields = z
  .object({
    name: z.string().trim().min(1).max(120),
    email: z
      .string()
      .trim()
      .email()
      .max(254)
      .transform((value) => value.toLowerCase()),
    smtpHost: z
      .string()
      .refine(
        (value) =>
          value === "smtp.ethereal.email" || value === env.ETHEREAL_HOST,
        "Only the configured Ethereal SMTP host is allowed.",
      )
      .optional(),
    smtpPort: z
      .number()
      .int()
      .refine(
        (value) => [465, 587].includes(value),
        "Use SMTP port 465 or 587.",
      )
      .optional(),
    smtpUser: z.string().trim().min(1).max(254).optional(),
    smtpPassword: z.string().min(1).max(1000).optional(),
    hourlyLimit: z
      .number()
      .int()
      .min(1)
      .max(env.SYSTEM_MAX_EMAILS_PER_HOUR)
      .default(env.MAX_EMAILS_PER_HOUR_PER_SENDER),
    minDelaySeconds: z
      .number()
      .int()
      .min(env.MIN_DELAY_SECONDS)
      .max(86400)
      .default(env.MIN_DELAY_SECONDS),
  })
  .strict();

sendersRouter.get("/", async (req, res) => {
  res.json({
    data: await prisma.sender.findMany({
      where: { userId: req.user!.id },
      select: safeSender,
      orderBy: { createdAt: "asc" },
    }),
  });
});
sendersRouter.post("/", async (req, res) => {
  const input = senderFields.parse(req.body);
  if (Boolean(input.smtpUser) !== Boolean(input.smtpPassword))
    throw new HttpError(
      400,
      "Provide both SMTP username and password, or leave both empty to use the environment account.",
    );
  const smtpUser = input.smtpUser ?? env.ETHEREAL_USER;
  const password = input.smtpPassword ?? env.ETHEREAL_PASS;
  if (!smtpUser || !password)
    throw new HttpError(
      400,
      "Provide Ethereal SMTP credentials or configure ETHEREAL_USER and ETHEREAL_PASS.",
    );
  const sender = await prisma.sender.create({
    data: {
      userId: req.user!.id,
      name: input.name,
      email: input.email,
      smtpHost: input.smtpHost ?? env.ETHEREAL_HOST,
      smtpPort: input.smtpPort ?? env.ETHEREAL_PORT,
      smtpUser,
      smtpPasswordEncrypted: encrypt(password),
      hourlyLimit: input.hourlyLimit,
      minDelaySeconds: input.minDelaySeconds,
    },
    select: safeSender,
  });
  res.status(201).json({ data: sender });
});
sendersRouter.patch("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const input = senderFields
    .partial()
    .refine(
      (value) => Object.keys(value).length > 0,
      "Provide at least one field.",
    )
    .parse(req.body);
  const owned = await prisma.sender.findFirst({
    where: { id, userId: req.user!.id },
    select: { id: true },
  });
  if (!owned) throw new HttpError(404, "Sender not found.");
  const { smtpPassword, ...fields } = input;
  const sender = await prisma.sender.update({
    where: { id_userId: { id, userId: req.user!.id } },
    data: {
      ...fields,
      ...(smtpPassword ? { smtpPasswordEncrypted: encrypt(smtpPassword) } : {}),
    },
    select: safeSender,
  });
  res.json({ data: sender });
});
sendersRouter.delete("/:id", async (req, res) => {
  const id = idSchema.parse(req.params.id);
  const owned = await prisma.sender.findFirst({
    where: { id, userId: req.user!.id },
    select: { id: true, _count: { select: { emails: true, batches: true } } },
  });
  if (!owned) throw new HttpError(404, "Sender not found.");
  if (owned._count.emails || owned._count.batches)
    throw new HttpError(
      409,
      "This sender has scheduled emails or email history and cannot be deleted.",
    );
  await prisma.sender.delete({
    where: { id_userId: { id, userId: req.user!.id } },
  });
  res.json({ data: { deleted: true } });
});
