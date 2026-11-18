-- Sesiones de una convocatoria: un paquete que se vende una vez con varias fechas. Aditiva, BD de cada empresa.
--
-- `edition_sessions`: cada sesión de una convocatoria (`product_editions`): día local (`starts_on`), hora de inicio
--   (`start_time` NULL = hora por confirmar; nunca se inventa), duración en minutos, zona horaria, título opcional,
--   estado (scheduled/done/cancelled) y una nota interna (`private_note`, p. ej. el enlace de la videollamada) que es
--   solo para el equipo: no se publica ni se envía. No hay inscripción por sesión: las personas confirmadas de la
--   convocatoria son las participantes de todas sus sesiones (una sola venta por paquete).
--
-- Sin claves foráneas (como el resto de este carril). Solo crea una tabla. Nunca se ejecuta al arrancar; el código
-- funciona igual sin ella (convocatorias sin sesiones).

CREATE TABLE IF NOT EXISTS edition_sessions (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  edition_id       INT UNSIGNED  NOT NULL,
  position         INT           NOT NULL DEFAULT 0,
  starts_on        DATE          NOT NULL,
  start_time       TIME          NULL,
  duration_minutes SMALLINT      NULL,
  timezone         VARCHAR(64)   NOT NULL DEFAULT 'Europe/Madrid',
  title            VARCHAR(160)  NULL,
  status           VARCHAR(16)   NOT NULL DEFAULT 'scheduled',
  private_note     VARCHAR(600)  NULL,
  created_at       BIGINT        NOT NULL,
  updated_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_edition_sessions_edition (edition_id, position),
  KEY idx_edition_sessions_date (starts_on),
  CONSTRAINT chk_edition_sessions_status CHECK (status IN ('scheduled','done','cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
