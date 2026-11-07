-- Elephant Net · rutas públicas (server/netPublic): carta QR por mesa (Restaurant Net), check-in online (Hotel Net) y
-- firma remota del contrato de alquiler (Ski Net). BD de cada empresa; solo crea tablas nuevas y vacías. Nunca se
-- ejecuta al arrancar.
--
-- `net_public_links`: enlaces públicos con token opaco. Solo se guarda la huella (SHA-256 del token ligado a la
-- empresa), nunca el token. Un enlace activo por objeto (active_key, columna generada): emitir otro revoca el anterior.
-- Estados: active | revoked | used (los de un solo uso, como la firma, pasan a used).
-- `restaurant_table_requests`: pedidos enviados desde la mesa. Quedan pendientes hasta que el camarero los confirma
-- (entonces pasan a la comanda de la mesa) o los rechaza. No hay cobro en línea.
-- `hotel_online_checkins`: datos del registro de viajeros que envía el huésped con su enlace. Recepción los aplica a las
-- fichas de huésped (0043) o los descarta; al hacerlo se vacía guests_json.

CREATE TABLE IF NOT EXISTS net_public_links (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kind          VARCHAR(24)   NOT NULL,
  target_id     INT UNSIGNED  NOT NULL,
  site_id       VARCHAR(63)   NULL DEFAULT NULL,
  token_hash    CHAR(64)      NOT NULL,
  status        VARCHAR(16)   NOT NULL DEFAULT 'active',
  expires_at    BIGINT        NULL DEFAULT NULL,
  uses          INT UNSIGNED  NOT NULL DEFAULT 0,
  last_used_at  BIGINT        NULL DEFAULT NULL,
  used_at       BIGINT        NULL DEFAULT NULL,
  created_by    VARCHAR(100)  NOT NULL,
  created_at    BIGINT        NOT NULL,
  revoked_at    BIGINT        NULL DEFAULT NULL,
  revoked_by    VARCHAR(100)  NULL DEFAULT NULL,
  active_key    VARCHAR(48)   GENERATED ALWAYS AS (IF(status = 'active', CONCAT(kind, ':', target_id), NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_net_public_links_token (token_hash),
  UNIQUE KEY uq_net_public_links_active (active_key),
  KEY idx_net_public_links_target (kind, target_id, id),
  CONSTRAINT chk_net_public_links_kind CHECK (kind IN ('restaurant_table', 'hotel_checkin', 'ski_contract')),
  CONSTRAINT chk_net_public_links_status CHECK (status IN ('active', 'revoked', 'used'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS restaurant_table_requests (
  id               INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  restaurant_id    INT            NOT NULL,
  table_id         INT            NOT NULL,
  link_id          INT UNSIGNED   NOT NULL,
  submit_key       VARCHAR(32)    NOT NULL,
  status           VARCHAR(16)    NOT NULL DEFAULT 'pending',
  lines_json       TEXT           NOT NULL,
  item_count       INT UNSIGNED   NOT NULL,
  estimated_total  DECIMAL(10,2)  NOT NULL DEFAULT 0,
  guest_note       VARCHAR(300)   NULL DEFAULT NULL,
  hospo_order_id   INT            NULL DEFAULT NULL,
  decided_by       INT            NULL DEFAULT NULL,
  decided_at       BIGINT         NULL DEFAULT NULL,
  decision_note    VARCHAR(255)   NULL DEFAULT NULL,
  created_at       BIGINT         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_restaurant_table_requests_submit (link_id, submit_key),
  KEY idx_restaurant_table_requests_restaurant (restaurant_id, status, id),
  KEY idx_restaurant_table_requests_table (table_id, status),
  CONSTRAINT chk_restaurant_table_requests_status CHECK (status IN ('pending', 'accepting', 'accepted', 'rejected'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_online_checkins (
  id              INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  reservation_id  INT           NOT NULL,
  link_id         INT UNSIGNED  NOT NULL,
  status          VARCHAR(16)   NOT NULL DEFAULT 'pending',
  guests_json     MEDIUMTEXT    NULL,
  guest_count     INT UNSIGNED  NOT NULL DEFAULT 0,
  submitted_at    BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  decided_by      INT           NULL DEFAULT NULL,
  decided_at      BIGINT        NULL DEFAULT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_online_checkins_link (link_id),
  KEY idx_hotel_online_checkins_reservation (reservation_id, id),
  CONSTRAINT chk_hotel_online_checkins_status CHECK (status IN ('pending', 'applied', 'discarded'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
