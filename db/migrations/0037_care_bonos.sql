-- Big Elephant — Care Net · bonos y paquetes de sesiones (aditiva, BD de cada empresa; capacidad care-net).
--
-- `care_session_packs`: definición de un bono (nombre, nº de sesiones, caducidad en días desde la compra, precio con
-- IVA incluido, tratamientos y/o categorías de SPA en los que vale; sin ninguno, vale para todos). Se archivan
-- (is_active = 0), no se borran.
-- `care_pack_purchases`: bono vendido a un cliente del CRM con la foto de la definición (sesiones, caducidad, precio
-- y validez). El cobro es siempre una venta del TPV del Core (tpv_sale_id; idempotencia por compra); sin cobrar
-- queda 'pending' y no se puede usar. request_key: clave del intento de venta (un doble clic no crea dos bonos).
-- sessions_used es el contador de sesiones consumidas (nunca supera sessions_total). site_id: sede de la caja que cobró (NULL = principal).
-- `care_pack_consumptions`: cada sesión consumida (por una reserva de SPA o una cita en mostrador), con su
-- reversión (status 'reverted', motivo y fecha) en lugar de borrarla. open_reservation_key impide consumir dos
-- veces por la misma reserva.
--
-- Solo crea tablas nuevas (no modifica ninguna existente). Sin la capacidad care-net no se usan. Nunca se ejecuta al
-- arrancar.

CREATE TABLE IF NOT EXISTS care_session_packs (
  id             INT            NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)    NULL DEFAULT NULL,
  name           VARCHAR(160)   NOT NULL,
  description    VARCHAR(512)   NULL DEFAULT NULL,
  sessions       INT            NOT NULL,
  validity_days  INT            NOT NULL,
  price          DECIMAL(10,2)  NOT NULL,
  treatment_ids  JSON           NULL,
  category_ids   JSON           NULL,
  is_active      TINYINT(1)     NOT NULL DEFAULT 1,
  created_at     BIGINT         NOT NULL,
  updated_at     BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_care_session_packs_active (is_active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS care_pack_purchases (
  id              INT            NOT NULL AUTO_INCREMENT,
  site_id         VARCHAR(63)    NULL DEFAULT NULL,
  pack_id         INT            NOT NULL,
  pack_name       VARCHAR(160)   NOT NULL,
  client_id       INT            NOT NULL,
  client_name     VARCHAR(256)   NOT NULL,
  sessions_total  INT            NOT NULL,
  sessions_used   INT            NOT NULL DEFAULT 0,
  price           DECIMAL(10,2)  NOT NULL,
  treatment_ids   JSON           NULL,
  category_ids    JSON           NULL,
  validity_days   INT            NOT NULL,
  status          VARCHAR(16)    NOT NULL DEFAULT 'pending',
  tpv_sale_id     INT            NULL DEFAULT NULL,
  purchased_at    BIGINT         NULL DEFAULT NULL,
  expires_at      BIGINT         NULL DEFAULT NULL,
  sold_by         INT            NULL DEFAULT NULL,
  notes           VARCHAR(500)   NULL DEFAULT NULL,
  request_key     VARCHAR(64)    NULL DEFAULT NULL,
  created_at      BIGINT         NOT NULL,
  updated_at      BIGINT         NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_care_pack_purchases_request (request_key),
  KEY idx_care_pack_purchases_client (client_id, status, expires_at),
  KEY idx_care_pack_purchases_pack (pack_id),
  KEY idx_care_pack_purchases_sale (tpv_sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS care_pack_consumptions (
  id                    INT           NOT NULL AUTO_INCREMENT,
  site_id               VARCHAR(63)   NULL DEFAULT NULL,
  purchase_id           INT           NOT NULL,
  client_id             INT           NOT NULL,
  reservation_id        INT           NULL DEFAULT NULL,
  treatment_id          INT           NULL DEFAULT NULL,
  slot_id               INT           NULL DEFAULT NULL,
  source                VARCHAR(16)   NOT NULL,
  status                VARCHAR(12)   NOT NULL DEFAULT 'consumed',
  consumed_by           INT           NULL DEFAULT NULL,
  consumed_at           BIGINT        NOT NULL,
  reverted_by           INT           NULL DEFAULT NULL,
  reverted_at           BIGINT        NULL DEFAULT NULL,
  revert_reason         VARCHAR(255)  NULL DEFAULT NULL,
  open_reservation_key  INT GENERATED ALWAYS AS (IF(status = 'consumed', reservation_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_care_pack_consumptions_reservation (open_reservation_key),
  KEY idx_care_pack_consumptions_purchase (purchase_id, status),
  KEY idx_care_pack_consumptions_client (client_id, consumed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
