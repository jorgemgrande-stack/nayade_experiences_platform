-- Ski Net · Fianzas del alquiler de material (capacidad ski-rental, server/skiRental/depositStore.ts). BD de cada
-- empresa; solo crea tablas nuevas y vacías (prefijo ski_deposit_), sin tocar las existentes: la relación con la
-- entrega y su contrato (ski_rental_deliveries) va en estas tablas, sin claves foráneas para que 0036 pueda revertirse.
-- Importes en céntimos enteros; marcas de tiempo en milisegundos (como la caja del TPV). Nunca se ejecuta al arrancar.
--
-- `ski_deposit_rules`: importe de fianza por modelo (model:<id>) o por tipo de material (type:<código>) en la sede.
-- `ski_deposits`: una fianza por entrega (uq_ski_deposits_delivery: registrar dos veces devuelve la misma). Estados
--   held (cobrada) → settling (venta de daños en curso) → refunded | retained_partial | retained_total.
-- `ski_deposit_charges`: cargos por daños que la fianza no cubre (o posteriores), cobrados en el TPV del Core.
--   pending → paying → paid, o cancelled. Una clave por liquidación y otra por petición evitan duplicados.
-- `ski_deposit_events`: justificante e historial (cobro, devolución, retención, cargo) con su movimiento de caja o
--   su venta del TPV.
-- `ski_deposit_attachments`: fotos de los daños (fichero privado del Core) de una fianza.

CREATE TABLE IF NOT EXISTS ski_deposit_rules (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id      VARCHAR(63)  NOT NULL,
  rule_key     VARCHAR(40)  NOT NULL,
  model_id     INT UNSIGNED NULL,
  asset_type   VARCHAR(24)  NULL,
  amount_cents INT UNSIGNED NOT NULL,
  active       TINYINT(1)   NOT NULL DEFAULT 1,
  updated_by   VARCHAR(100) NULL,
  updated_at   BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_deposit_rules_key (site_id, rule_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_deposits (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id             VARCHAR(63)  NOT NULL,
  delivery_id         INT UNSIGNED NOT NULL,
  customer_name       VARCHAR(120) NOT NULL,
  amount_cents        INT UNSIGNED NOT NULL,
  method              VARCHAR(16)  NOT NULL,
  external_ref        VARCHAR(120) NULL,
  status              VARCHAR(20)  NOT NULL DEFAULT 'held',
  collect_session_id  INT          NULL,
  collect_movement_id INT          NULL,
  collected_by        VARCHAR(100) NOT NULL,
  collected_at        BIGINT       NOT NULL,
  damage_cents        INT UNSIGNED NULL,
  refunded_cents      INT UNSIGNED NULL,
  retained_cents      INT UNSIGNED NULL,
  settle_session_id   INT          NULL,
  settle_reason       VARCHAR(300) NULL,
  settle_note         VARCHAR(1000) NULL,
  damage_sale_id      INT          NULL,
  extra_charge_id     INT UNSIGNED NULL,
  settled_by          VARCHAR(100) NULL,
  settled_at          BIGINT       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_deposits_delivery (delivery_id),
  KEY idx_ski_deposits_site_status (site_id, status),
  KEY idx_ski_deposits_site_collected (site_id, collected_at),
  KEY idx_ski_deposits_site_settled (site_id, settled_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_deposit_charges (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)  NOT NULL,
  delivery_id    INT UNSIGNED NOT NULL,
  deposit_id     INT UNSIGNED NULL,
  settlement_key INT UNSIGNED NULL,
  request_key    VARCHAR(64)  NULL,
  amount_cents   INT UNSIGNED NOT NULL,
  reason         VARCHAR(300) NOT NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  tpv_sale_id    INT          NULL,
  pay_method     VARCHAR(16)  NULL,
  pay_session_id INT          NULL,
  created_by     VARCHAR(100) NOT NULL,
  created_at     BIGINT       NOT NULL,
  paid_by        VARCHAR(100) NULL,
  paid_at        BIGINT       NULL,
  cancel_reason  VARCHAR(300) NULL,
  cancelled_by   VARCHAR(100) NULL,
  cancelled_at   BIGINT       NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_deposit_charges_settlement (settlement_key),
  UNIQUE KEY uq_ski_deposit_charges_request (site_id, request_key),
  KEY idx_ski_deposit_charges_site_status (site_id, status),
  KEY idx_ski_deposit_charges_delivery (delivery_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_deposit_events (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id          VARCHAR(63)  NOT NULL,
  deposit_id       INT UNSIGNED NULL,
  charge_id        INT UNSIGNED NULL,
  delivery_id      INT UNSIGNED NOT NULL,
  kind             VARCHAR(24)  NOT NULL,
  amount_cents     INT UNSIGNED NOT NULL DEFAULT 0,
  method           VARCHAR(16)  NULL,
  cash_session_id  INT          NULL,
  cash_movement_id INT          NULL,
  tpv_sale_id      INT          NULL,
  note             VARCHAR(300) NULL,
  actor            VARCHAR(100) NOT NULL,
  created_at       BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ski_deposit_events_deposit (deposit_id),
  KEY idx_ski_deposit_events_charge (charge_id),
  KEY idx_ski_deposit_events_site_created (site_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_deposit_attachments (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id    VARCHAR(63)  NOT NULL,
  deposit_id INT UNSIGNED NOT NULL,
  file_url   VARCHAR(500) NOT NULL,
  file_name  VARCHAR(200) NOT NULL,
  mime_type  VARCHAR(80)  NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_ski_deposit_attachments_deposit (deposit_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
