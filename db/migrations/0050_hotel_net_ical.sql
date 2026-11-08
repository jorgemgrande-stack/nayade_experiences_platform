-- Hotel Net · sincronización de calendarios iCal (server/hotelIcal*.ts, capacidad hotel-net): el «Channel Manager»
-- mínimo que aceptan Booking, Airbnb, Vrbo y Google. BD de cada empresa; solo crea tablas nuevas y vacías. Nunca se
-- ejecuta al arrancar. No altera ninguna tabla existente: los bloqueos importados viven aquí y la disponibilidad los
-- descuenta al calcular la ocupación (server/inventoryHoldsDb.hotelOccupancy). Sin estas tablas todo sigue como antes.
--
-- `hotel_ical_settings`: interruptor de la sincronización automática de la empresa (fila única id = 1). Sin fila,
-- apagado; se enciende solo al configurar la primera URL de importación.
-- `hotel_ical_exports`: enlaces públicos secretos GET /ical/<token>.ics por tipología o habitación y canal. Solo se
-- guarda la huella del token (SHA-256 ligado a la empresa) y la semilla con la que el servidor lo deriva (HMAC con su
-- clave): una copia de la BD no permite reconstruir los enlaces. Uno activo por (destino, canal): rotar revoca el
-- anterior (active_key, columna generada).
-- `hotel_ical_feeds`: URLs iCal de importación de cada canal por tipología o habitación, con el estado de la última
-- sincronización. Estados: active | paused | archived (nunca se borran).
-- `hotel_ical_blocks`: eventos importados (por UID) como bloqueos de disponibilidad de origen externo. Sin datos del
-- huésped: solo UID y fechas. Estados: active | cancelled (un evento que desaparece del canal se cancela, no se borra).

CREATE TABLE IF NOT EXISTS hotel_ical_settings (
  id                 TINYINT UNSIGNED  NOT NULL,
  auto_sync_enabled  TINYINT(1)        NOT NULL DEFAULT 0,
  updated_by         VARCHAR(100)      NULL DEFAULT NULL,
  updated_at         BIGINT            NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_hotel_ical_settings_id CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_ical_exports (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  target_kind      VARCHAR(16)   NOT NULL,
  target_id        INT           NOT NULL,
  channel          VARCHAR(16)   NOT NULL,
  nonce            CHAR(32)      NOT NULL,
  token_hash       CHAR(64)      NOT NULL,
  status           VARCHAR(16)   NOT NULL DEFAULT 'active',
  fetch_count      INT UNSIGNED  NOT NULL DEFAULT 0,
  last_fetched_at  BIGINT        NULL DEFAULT NULL,
  created_by       VARCHAR(100)  NOT NULL,
  created_at       BIGINT        NOT NULL,
  revoked_at       BIGINT        NULL DEFAULT NULL,
  revoked_by       VARCHAR(100)  NULL DEFAULT NULL,
  active_key       VARCHAR(64)   GENERATED ALWAYS AS (IF(status = 'active', CONCAT(target_kind, ':', target_id, ':', channel), NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_ical_exports_token (token_hash),
  UNIQUE KEY uq_hotel_ical_exports_active (active_key),
  KEY idx_hotel_ical_exports_target (target_kind, target_id, status),
  CONSTRAINT chk_hotel_ical_exports_kind CHECK (target_kind IN ('room_type', 'room')),
  CONSTRAINT chk_hotel_ical_exports_status CHECK (status IN ('active', 'revoked'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_ical_feeds (
  id                    INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  target_kind           VARCHAR(16)    NOT NULL,
  target_id             INT            NOT NULL,
  channel               VARCHAR(16)    NOT NULL,
  label                 VARCHAR(120)   NULL DEFAULT NULL,
  url                   VARCHAR(2000)  NOT NULL,
  status                VARCHAR(16)    NOT NULL DEFAULT 'active',
  last_attempt_at       BIGINT         NULL DEFAULT NULL,
  last_success_at       BIGINT         NULL DEFAULT NULL,
  last_status           VARCHAR(16)    NULL DEFAULT NULL,
  last_error            VARCHAR(500)   NULL DEFAULT NULL,
  consecutive_failures  INT UNSIGNED   NOT NULL DEFAULT 0,
  event_count           INT UNSIGNED   NOT NULL DEFAULT 0,
  last_added            INT UNSIGNED   NOT NULL DEFAULT 0,
  last_updated          INT UNSIGNED   NOT NULL DEFAULT 0,
  last_cancelled        INT UNSIGNED   NOT NULL DEFAULT 0,
  created_by            VARCHAR(100)   NOT NULL,
  created_at            BIGINT         NOT NULL,
  updated_at            BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hotel_ical_feeds_status (status, last_attempt_at),
  KEY idx_hotel_ical_feeds_target (target_kind, target_id, channel),
  CONSTRAINT chk_hotel_ical_feeds_kind CHECK (target_kind IN ('room_type', 'room')),
  CONSTRAINT chk_hotel_ical_feeds_status CHECK (status IN ('active', 'paused', 'archived'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_ical_blocks (
  id             BIGINT UNSIGNED  NOT NULL AUTO_INCREMENT,
  feed_id        INT UNSIGNED     NOT NULL,
  uid_hash       CHAR(64)         NOT NULL,
  uid            VARCHAR(255)     NOT NULL,
  room_type_id   INT              NOT NULL,
  hotel_room_id  INT              NULL DEFAULT NULL,
  start_date     VARCHAR(10)      NOT NULL,
  end_date       VARCHAR(10)      NOT NULL,
  status         VARCHAR(16)      NOT NULL DEFAULT 'active',
  first_seen_at  BIGINT           NOT NULL,
  updated_at     BIGINT           NOT NULL,
  cancelled_at   BIGINT           NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_ical_blocks_uid (feed_id, uid_hash),
  KEY idx_hotel_ical_blocks_range (status, room_type_id, start_date, end_date),
  CONSTRAINT chk_hotel_ical_blocks_status CHECK (status IN ('active', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
