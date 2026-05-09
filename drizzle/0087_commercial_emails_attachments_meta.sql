-- Añade columna attachments_meta a commercial_emails (schema drift fix)
-- Nota: si la columna ya existe, este ALTER falla con ER_DUP_FIELDNAME — ignorar.
ALTER TABLE `commercial_emails`
  ADD COLUMN `attachments_meta` JSON NULL AFTER `has_attachments`;
