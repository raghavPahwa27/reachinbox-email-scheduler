-- Mailbox mutations need new index job IDs, just like delivery status changes.
CREATE OR REPLACE FUNCTION reachinbox_email_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW."senderId", NEW."userId", NEW.recipient, NEW.subject, NEW.body,
         NEW."bodyHtml", NEW.status, NEW."scheduledAt", NEW."sentAt",
         NEW.starred, NEW.archived, NEW."trashedAt")
     IS DISTINCT FROM
     ROW(OLD."senderId", OLD."userId", OLD.recipient, OLD.subject, OLD.body,
         OLD."bodyHtml", OLD.status, OLD."scheduledAt", OLD."sentAt",
         OLD.starred, OLD.archived, OLD."trashedAt")
     OR NEW."searchVersion" > OLD."searchVersion" THEN
    NEW."searchVersion" := OLD."searchVersion" + 1;
    NEW."indexDirty" := true;
  END IF;
  RETURN NEW;
END $$;

-- Repair already-indexed rows; incrementing also emits the existing NOTIFY wakeup.
UPDATE "Email" SET "searchVersion" = "searchVersion" + 1, "indexDirty" = true;
