-- Big Elephant — Care Net · recordatorios de cita (aditiva, BD de cada empresa; capacidad care-net).
--
-- `care_reminder_settings`: ajustes de la empresa (una fila, id = 1): recordatorios activados (por defecto NO),
-- antelaciones en horas (JSON, p. ej. [24, 2]) y texto adicional que se añade al correo. Sin fila = apagado.
-- `care_reminder_sends`: un registro por cita (reserva de SPA del Core) y antelación (lead_hours; 0 = envío manual
-- desde el panel). La clave única (reservation_id, lead_hours) hace el envío idempotente: se reserva el registro
-- ('sending') ANTES de enviar y se cierra como 'sent', 'failed' (con reintentos limitados) o 'skipped' con su motivo
-- (sin correo, superado por otra antelación, prueba gratuita…). No guarda el correo del cliente ni datos clínicos.
--
-- Solo crea tablas nuevas (no modifica ninguna existente). Sin la capacidad care-net no se usan. Nunca se ejecuta al
-- arrancar.

CREATE TABLE IF NOT EXISTS care_reminder_settings (
  id           TINYINT UNSIGNED NOT NULL,
  enabled      TINYINT(1)       NOT NULL DEFAULT 0,
  lead_hours   JSON             NULL,
  extra_text   VARCHAR(500)     NULL DEFAULT NULL,
  updated_by   INT              NULL DEFAULT NULL,
  updated_at   BIGINT           NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS care_reminder_sends (
  id              INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  reservation_id  INT               NOT NULL,
  lead_hours      SMALLINT UNSIGNED NOT NULL,
  appointment_at  BIGINT            NOT NULL,
  status          VARCHAR(12)       NOT NULL DEFAULT 'sending',
  reason          VARCHAR(64)       NULL DEFAULT NULL,
  attempts        TINYINT UNSIGNED  NOT NULL DEFAULT 1,
  sent_by         INT               NULL DEFAULT NULL,
  sent_at         BIGINT            NULL DEFAULT NULL,
  created_at      BIGINT            NOT NULL,
  updated_at      BIGINT            NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_care_reminder_sends_once (reservation_id, lead_hours),
  KEY idx_care_reminder_sends_status (status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
