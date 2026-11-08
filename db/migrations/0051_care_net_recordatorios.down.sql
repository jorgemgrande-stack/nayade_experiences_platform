-- Reversión de 0051_care_net_recordatorios: se pierden los ajustes de recordatorios de Care Net y el registro de
-- recordatorios enviados (las reservas de SPA y los correos ya enviados no se tocan). Antes, desplegar el código
-- anterior a este cambio.
DROP TABLE IF EXISTS care_reminder_sends;
DROP TABLE IF EXISTS care_reminder_settings;
