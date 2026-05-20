-- Gestoría e Impuestos — cron de avisos de vencimiento.
--
-- last_reminder_days: último umbral (15/7/1 días) para el que ya se envió un
-- aviso de vencimiento de la obligación. Garantiza la idempotencia del cron.
--
-- Migración idempotente: ver scripts/apply-tax-reminder.cjs.

ALTER TABLE `tax_obligations`
  ADD COLUMN `last_reminder_days` int NULL;
