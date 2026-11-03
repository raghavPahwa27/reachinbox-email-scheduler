ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Email" ADD COLUMN "bodyHtml" TEXT,
  ADD COLUMN "starred" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archived" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "trashedAt" TIMESTAMP(3);
CREATE TABLE "Attachment" (
  "id" UUID PRIMARY KEY,
  "batchId" UUID NOT NULL REFERENCES "ScheduleBatch"("id") ON DELETE CASCADE,
  "filename" TEXT NOT NULL,
  "contentType" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "content" BYTEA NOT NULL
);
CREATE INDEX "Attachment_batchId_idx" ON "Attachment"("batchId");
UPDATE "Email" SET "indexDirty" = true;
