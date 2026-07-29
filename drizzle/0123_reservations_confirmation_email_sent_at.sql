-- El email de confirmación de reserva se dispara hoy a mano en cada canal
-- (TPV, ticketing/cupones, partners, CRM, Redsys), sin ningún registro común
-- de si realmente se envió. Varios canales (Groupon/partners gestionados vía
-- CRM, conversión de presupuesto sin cobro previo) se quedaban sin enviar
-- nada porque no existía un evento único de "reserva confirmada".
--
-- Añadimos `confirmation_email_sent_at` como marca de trazabilidad y guarda
-- de idempotencia para el nuevo helper centralizado
-- (server/reservationEmails.ts: confirmReservationAndNotify). Nullable, sin
-- default: no altera ninguna fila existente.
--
-- Migración idempotente: ver scripts/apply-reservations-confirmation-email-sent-at.cjs

ALTER TABLE `reservations`
  ADD COLUMN `confirmation_email_sent_at` timestamp NULL;
