-- Reservas delegadas — justificante de la reserva creada por el administrador.
--
-- Cuando el administrador crea una reserva en nombre de un partner, puede
-- adjuntar un justificante (PDF/imagen) y una nota explicando el motivo.
--
--   delegation_proof_url / delegation_proof_key → documento justificativo.
--   delegation_note                            → motivo de la reserva delegada.
--
-- Migración idempotente: ver scripts/apply-reservation-delegation.cjs.

ALTER TABLE `reservations`
  ADD COLUMN `delegation_proof_url` TEXT NULL,
  ADD COLUMN `delegation_proof_key` VARCHAR(512) NULL,
  ADD COLUMN `delegation_note` TEXT NULL;
