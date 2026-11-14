-- Convocatorias (E-4): ediciones con fechas y plazas de un producto. Aditiva, BD de cada empresa.
--
-- `product_editions`: cada edición (convocatoria) de un producto (`experiences`): etiqueta, fechas (milisegundos UTC y
--   zona horaria), horario en texto libre, modalidad, lugar, plazas (`capacity` NULL = sin límite), plazas confirmadas
--   (`reserved`), estado y precio propio opcional. `reserved` solo lo modifican las inscripciones confirmadas y siempre
--   con un UPDATE condicionado (nunca supera `capacity`): la restricción CHECK es la última red contra la sobreventa.
-- `edition_enrollments`: solicitudes de plaza. Nacen «solicitada» (o «lista_espera»); solo el administrador las
--   confirma. `lead_id` enlaza con la oportunidad del CRM; `order_id` queda para el pedido que se cree después a mano.
--   Guarda el consentimiento RGPD tal como lo vio la persona y una huella de la IP (HMAC; nunca la dirección).
--
-- Sin claves foráneas (como el resto de este carril). Solo crea tablas. Nunca se ejecuta al arrancar; el código
-- funciona igual sin ellas (sin convocatorias).

CREATE TABLE IF NOT EXISTS product_editions (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  experience_id  INT           NOT NULL,
  label          VARCHAR(160)  NOT NULL,
  starts_at      BIGINT        NOT NULL,
  ends_at        BIGINT        NULL,
  timezone       VARCHAR(64)   NOT NULL DEFAULT 'Europe/Madrid',
  schedule_note  VARCHAR(600)  NULL,
  mode           ENUM('online','presencial','hibrido') NOT NULL DEFAULT 'presencial',
  location_note  VARCHAR(300)  NULL,
  capacity       INT           NULL,
  reserved       INT           NOT NULL DEFAULT 0,
  show_availability TINYINT(1) NOT NULL DEFAULT 0,
  status         ENUM('draft','open','waitlist','closed','cancelled') NOT NULL DEFAULT 'draft',
  price_override DECIMAL(10,2) NULL,
  sort           INT           NOT NULL DEFAULT 0,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_product_editions_product (experience_id, status, starts_at),
  KEY idx_product_editions_start (starts_at),
  CONSTRAINT chk_product_editions_reserved CHECK (reserved >= 0 AND (capacity IS NULL OR reserved <= capacity))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS edition_enrollments (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  edition_id      INT UNSIGNED  NOT NULL,
  client_id       INT           NULL,
  lead_id         INT           NULL,
  name            VARCHAR(200)  NOT NULL,
  email           VARCHAR(320)  NOT NULL,
  phone           VARCHAR(40)   NULL,
  seats           INT           NOT NULL DEFAULT 1,
  status          ENUM('solicitada','confirmada','lista_espera','cancelada') NOT NULL DEFAULT 'solicitada',
  order_id        INT           NULL,
  notes           VARCHAR(2000) NULL,
  consent_given   TINYINT(1)    NOT NULL DEFAULT 0,
  consent_text    VARCHAR(400)  NULL,
  consent_version VARCHAR(16)   NULL,
  consent_at      BIGINT        NULL,
  ip_hash         CHAR(64)      NULL,
  page            VARCHAR(200)  NULL,
  confirmed_at    BIGINT        NULL,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_edition_enrollments_edition (edition_id, status),
  KEY idx_edition_enrollments_lead (lead_id),
  KEY idx_edition_enrollments_email (email(120), edition_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
