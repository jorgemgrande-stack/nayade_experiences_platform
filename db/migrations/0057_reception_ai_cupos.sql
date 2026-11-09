-- Elephant Reception AI (server/receptionAi/*): cupos diarios del chat de la web por empresa (fecha del día en la zona
-- horaria de la empresa, Europe/Madrid por defecto). Un contador por día y tipo: respuestas de la IA (`chat_reply`) y
-- solicitudes creadas desde el chat (`chat_lead`). La reserva es atómica (UPDATE condicionado por el máximo) antes de
-- llamar a la IA o de crear la solicitud. Fuera de drizzle/schema.ts. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS reception_ai_cupos (
  dia         DATE          NOT NULL,
  tipo        VARCHAR(16)   NOT NULL,
  usados      INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (dia, tipo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
