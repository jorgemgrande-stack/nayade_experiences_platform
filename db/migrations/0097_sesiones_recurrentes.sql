-- Sesiones recurrentes de compra permanente (Elephant Core · server/recurringSessionsDb.ts), p. ej. MORNING IMPULSE:
-- todos los lunes 07:30, 30 min, directo por Zoom, 4 sesiones por compra, incorporación semanal. Solo CREATE TABLE (aditiva,
-- sin tocar datos existentes). Nunca se ejecuta al arrancar. Ninguna oferta nace activa: `active` = 0 por defecto.
--
-- recurring_session_offers       : configuración por producto (y variante opcional: 0 = todas): día ISO, hora local, ZONA HORARIA
--                                  explícita (+ marca de confirmada por la titular), duración, nº de sesiones, margen de antelación
--                                  y enlace de Zoom OPCIONAL (nunca se inventa).
-- recurring_session_entitlements : derecho de participación de cada compra (una fila por línea de pedido pagada, única por
--                                  reservation_id → idempotente ante reintentos del cobro): sus fechas calculadas AL PAGAR, plazas,
--                                  estado de los avisos y de Zoom («pendiente» mientras no haya enlace real).
CREATE TABLE IF NOT EXISTS recurring_session_offers (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  product_id         INT          NOT NULL,
  variant_id         INT          NOT NULL DEFAULT 0,
  title              VARCHAR(160) NOT NULL DEFAULT '',
  weekday            TINYINT UNSIGNED NOT NULL DEFAULT 1,
  start_time         CHAR(5)      NOT NULL DEFAULT '07:30',
  timezone           VARCHAR(64)  NOT NULL DEFAULT 'Europe/Madrid',
  timezone_confirmed TINYINT(1)   NOT NULL DEFAULT 0,
  duration_minutes   SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  sessions_count     SMALLINT UNSIGNED NOT NULL DEFAULT 4,
  lead_minutes       INT UNSIGNED NOT NULL DEFAULT 60,
  zoom_url           VARCHAR(500) NULL,
  active             TINYINT(1)   NOT NULL DEFAULT 0,
  created_at         BIGINT       NOT NULL,
  updated_at         BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recurring_offer_product_variant (product_id, variant_id),
  CONSTRAINT chk_recurring_offer_weekday CHECK (weekday BETWEEN 1 AND 7)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS recurring_session_entitlements (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  offer_id        INT UNSIGNED NOT NULL,
  reservation_id  INT          NOT NULL,
  merchant_order  VARCHAR(64)  NULL,
  customer_name   VARCHAR(200) NOT NULL DEFAULT '',
  customer_email  VARCHAR(254) NOT NULL,
  locale          VARCHAR(8)   NOT NULL DEFAULT 'de',
  seats           SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  timezone        VARCHAR(64)  NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  sessions_json   TEXT         NOT NULL,
  first_session_at BIGINT      NOT NULL,
  last_session_at  BIGINT      NOT NULL,
  status          VARCHAR(12)  NOT NULL DEFAULT 'active',
  notice_status   VARCHAR(12)  NOT NULL DEFAULT 'pending',
  notice_claimed_at BIGINT     NULL,
  notice_sent_at  BIGINT       NULL,
  notice_error    VARCHAR(300) NULL,
  zoom_status     VARCHAR(12)  NOT NULL DEFAULT 'pending',
  zoom_claimed_at BIGINT       NULL,
  zoom_sent_at    BIGINT       NULL,
  zoom_error      VARCHAR(300) NULL,
  granted_at      BIGINT       NOT NULL,
  updated_at      BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_recurring_entitlement_reservation (reservation_id),
  KEY idx_recurring_entitlement_offer (offer_id, first_session_at),
  KEY idx_recurring_entitlement_zoom (zoom_status, status),
  CONSTRAINT chk_recurring_entitlement_status CHECK (status IN ('active', 'revoked')),
  CONSTRAINT chk_recurring_entitlement_notice CHECK (notice_status IN ('pending', 'sending', 'sent', 'failed')),
  CONSTRAINT chk_recurring_entitlement_zoom CHECK (zoom_status IN ('pending', 'sending', 'sent', 'failed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
