-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('SCHEDULED', 'PROCESSING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "googleId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "avatar" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Sender" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "smtpHost" TEXT NOT NULL DEFAULT 'smtp.ethereal.email',
    "smtpPort" INTEGER NOT NULL DEFAULT 587,
    "smtpUser" TEXT NOT NULL,
    "smtpPasswordEncrypted" TEXT NOT NULL,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 200,
    "minDelaySeconds" INTEGER NOT NULL DEFAULT 2,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Sender_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleBatch" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScheduleBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Email" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "senderId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "recipient" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "originalScheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" "EmailStatus" NOT NULL DEFAULT 'SCHEDULED',
    "bullJobId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "errorMessage" TEXT,
    "previewUrl" TEXT,
    "delaySeconds" INTEGER NOT NULL,
    "hourlyLimit" INTEGER NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "processingAt" TIMESTAMP(3),
    "indexDirty" BOOLEAN NOT NULL DEFAULT true,
    "searchVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlackIntegration" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "teamName" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SlackIntegration_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_googleId_key" ON "User"("googleId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Sender_id_userId_key" ON "Sender"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Sender_userId_email_key" ON "Sender"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleBatch_userId_idempotencyKey_key" ON "ScheduleBatch"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleBatch_id_userId_key" ON "ScheduleBatch"("id", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_bullJobId_key" ON "Email"("bullJobId");

-- CreateIndex
CREATE UNIQUE INDEX "Email_idempotencyKey_key" ON "Email"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Email_userId_status_scheduledAt_id_idx" ON "Email"("userId", "status", "scheduledAt", "id");

-- CreateIndex
CREATE INDEX "Email_userId_status_sentAt_id_idx" ON "Email"("userId", "status", "sentAt", "id");

-- CreateIndex
CREATE INDEX "Email_senderId_status_originalScheduledAt_idx" ON "Email"("senderId", "status", "originalScheduledAt");

-- CreateIndex
CREATE INDEX "Email_indexDirty_updatedAt_idx" ON "Email"("indexDirty", "updatedAt");

-- CreateIndex
CREATE INDEX "Email_status_updatedAt_idx" ON "Email"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "SlackIntegration_userId_key" ON "SlackIntegration"("userId");

-- AddForeignKey
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBatch" ADD CONSTRAINT "ScheduleBatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleBatch" ADD CONSTRAINT "ScheduleBatch_senderId_userId_fkey" FOREIGN KEY ("senderId", "userId") REFERENCES "Sender"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_senderId_userId_fkey" FOREIGN KEY ("senderId", "userId") REFERENCES "Sender"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_batchId_userId_fkey" FOREIGN KEY ("batchId", "userId") REFERENCES "ScheduleBatch"("id", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlackIntegration" ADD CONSTRAINT "SlackIntegration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce invariants independently of HTTP validation.
ALTER TABLE "Sender" ADD CONSTRAINT "Sender_limits_check" CHECK ("hourlyLimit" > 0 AND "minDelaySeconds" >= 0 AND "smtpPort" IN (465,587));
ALTER TABLE "Email" ADD CONSTRAINT "Email_limits_check" CHECK ("hourlyLimit" > 0 AND "delaySeconds" >= 0 AND "attempts" >= 0 AND "searchVersion" > 0);
ALTER TABLE "Email" ADD CONSTRAINT "Email_sentAt_check" CHECK ((status = 'SENT') = ("sentAt" IS NOT NULL));

-- Durable search versions prevent older concurrent indexing writes from winning.
CREATE FUNCTION reachinbox_email_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."senderId", NEW."userId", NEW.recipient, NEW.subject, NEW.body, NEW.status, NEW."scheduledAt", NEW."sentAt")
     IS DISTINCT FROM ROW(OLD."senderId", OLD."userId", OLD.recipient, OLD.subject, OLD.body, OLD.status, OLD."scheduledAt", OLD."sentAt")
     OR NEW."searchVersion" > OLD."searchVersion" THEN
    NEW."searchVersion" := OLD."searchVersion" + 1;
    NEW."indexDirty" := true;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER email_version BEFORE UPDATE ON "Email" FOR EACH ROW EXECUTE FUNCTION reachinbox_email_version();

-- PostgreSQL delivers NOTIFY only after commit. Payloads are IDs, never email content.
CREATE FUNCTION reachinbox_email_wakeup() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM pg_notify('reachinbox_work', NEW.id::text);
  ELSIF NEW."searchVersion" IS DISTINCT FROM OLD."searchVersion" THEN
    PERFORM pg_notify('reachinbox_work', NEW.id::text);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER email_wakeup AFTER INSERT OR UPDATE ON "Email" FOR EACH ROW EXECUTE FUNCTION reachinbox_email_wakeup();

CREATE FUNCTION reachinbox_sender_reindex() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE "Email" SET "searchVersion" = "searchVersion" + 1, "indexDirty" = true WHERE "senderId" = NEW.id;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sender_reindex AFTER UPDATE ON "Sender" FOR EACH ROW EXECUTE FUNCTION reachinbox_sender_reindex();
