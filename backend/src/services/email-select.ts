import type { Prisma } from "@prisma/client";
export const emailSelect = {
  id: true,
  recipient: true,
  subject: true,
  body: true,
  bodyHtml: true,
  starred: true,
  archived: true,
  trashedAt: true,
  status: true,
  scheduledAt: true,
  originalScheduledAt: true,
  sentAt: true,
  errorMessage: true,
  previewUrl: true,
  createdAt: true,
  senderId: true,
  sender: { select: { email: true, name: true } },
  batch: {
    select: {
      attachments: {
        select: { id: true, filename: true, contentType: true, size: true },
      },
    },
  },
} satisfies Prisma.EmailSelect;
