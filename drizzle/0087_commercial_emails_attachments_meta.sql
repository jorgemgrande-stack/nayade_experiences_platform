-- Añade columna attachments_meta a commercial_emails (schema drift fix)
ALTER TABLE `commercial_emails`
  ADD COLUMN IF NOT EXISTS `attachments_meta` JSON NULL AFTER `has_attachments`;
