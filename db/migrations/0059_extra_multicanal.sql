-- Venta multicanal (server/multichannelDb.ts, capacidad multichannel): canales externos de la empresa (marketplaces,
-- OTA, agencias y canales de entradas como Fourvenues o Weezevent) con su comisión; publicaciones de productos del Core
-- en cada canal (código del canal → experiencia, tratamiento de spa o tipo de habitación); cupo por canal y día; ventas
-- recibidas de cada canal (CSV o enlace de entrada), idempotentes por referencia del canal, con la reserva que crean en
-- el Core y lo que consumen del cupo (con los datos originales de cada venta en sale_input para reintentarla tal cual y
-- el estado del paso de contabilidad y Operaciones en ops_status: pendiente, hecho, error o anulada, con el
-- reclamo de quien lo ejecuta en ops_claim); importaciones de informes y liquidaciones de cada canal. Fechas de calendario como
-- texto AAAA-MM-DD; importes en céntimos. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS mc_channels (
  id                     INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name                   VARCHAR(120)  NOT NULL,
  kind                   VARCHAR(16)   NOT NULL DEFAULT 'marketplace',
  provider               VARCHAR(24)   NOT NULL DEFAULT 'generic',
  commission_pct         DECIMAL(5,2)  NOT NULL DEFAULT 0.00,
  commission_fixed_cents INT UNSIGNED  NOT NULL DEFAULT 0,
  settlement_days        SMALLINT UNSIGNED NULL,
  is_active              TINYINT(1)    NOT NULL DEFAULT 1,
  inbound_token_hash     CHAR(64)      NULL,
  inbound_token_hint     VARCHAR(8)    NULL,
  csv_mapping            VARCHAR(2000) NULL,
  notes                  VARCHAR(1000) NULL,
  created_by             INT           NULL,
  created_at             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at             TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_channels_name (name),
  UNIQUE KEY uq_mc_channels_token (inbound_token_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mc_listings (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  channel_id       INT UNSIGNED  NOT NULL,
  external_code    VARCHAR(80)   NOT NULL,
  label            VARCHAR(200)  NULL,
  target_kind      VARCHAR(16)   NOT NULL,
  target_id        INT           NOT NULL,
  time_slot_id     INT           NULL,
  unit_price_cents INT UNSIGNED  NULL,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  created_by       INT           NULL,
  created_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_listings_code (channel_id, external_code),
  KEY idx_mc_listings_target (target_kind, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mc_allocations (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  listing_id   INT UNSIGNED  NOT NULL,
  channel_id   INT UNSIGNED  NOT NULL,
  day          CHAR(10)      NOT NULL,
  quota_units  INT UNSIGNED  NOT NULL DEFAULT 0,
  sold_units   INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_by   INT           NULL,
  created_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_allocations_day (listing_id, day),
  KEY idx_mc_allocations_channel (channel_id, day),
  CONSTRAINT chk_mc_allocations_sold CHECK (sold_units <= quota_units)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mc_sales (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  channel_id        INT UNSIGNED  NOT NULL,
  external_ref      VARCHAR(128)  NOT NULL,
  listing_id        INT UNSIGNED  NULL,
  source            VARCHAR(12)   NOT NULL,
  status            VARCHAR(12)   NOT NULL,
  problem           VARCHAR(500)  NULL,
  service_day       CHAR(10)      NULL,
  service_end_day   CHAR(10)      NULL,
  service_time      VARCHAR(5)    NULL,
  units             INT UNSIGNED  NOT NULL DEFAULT 1,
  people            INT UNSIGNED  NOT NULL DEFAULT 1,
  gross_cents       INT UNSIGNED  NOT NULL DEFAULT 0,
  commission_cents  INT UNSIGNED  NOT NULL DEFAULT 0,
  net_cents         INT           NOT NULL DEFAULT 0,
  customer_name     VARCHAR(200)  NULL,
  customer_email    VARCHAR(255)  NULL,
  customer_phone    VARCHAR(50)   NULL,
  reservation_id    INT           NULL,
  product_code      VARCHAR(80)   NULL,
  sale_input        TEXT          NULL,
  ops_status        VARCHAR(12)   NULL,
  ops_error         VARCHAR(500)  NULL,
  ops_at            TIMESTAMP(3)  NULL,
  ops_claim         CHAR(16)      NULL,
  import_id         INT UNSIGNED  NULL,
  settlement_id     INT UNSIGNED  NULL,
  sold_at           TIMESTAMP(3)  NULL,
  cancelled_at      TIMESTAMP(3)  NULL,
  created_by        INT           NULL,
  created_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_mc_sales_ref (channel_id, external_ref),
  KEY idx_mc_sales_status (channel_id, status, service_day),
  KEY idx_mc_sales_settlement (settlement_id),
  KEY idx_mc_sales_reservation (reservation_id),
  KEY idx_mc_sales_ops (ops_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mc_sale_allocations (
  sale_id        INT UNSIGNED NOT NULL,
  allocation_id  INT UNSIGNED NOT NULL,
  units          INT UNSIGNED NOT NULL,
  PRIMARY KEY (sale_id, allocation_id),
  KEY idx_mc_sale_allocations_alloc (allocation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mc_imports (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  channel_id    INT UNSIGNED  NOT NULL,
  file_name     VARCHAR(200)  NULL,
  rows_total    INT UNSIGNED  NOT NULL DEFAULT 0,
  registered    INT UNSIGNED  NOT NULL DEFAULT 0,
  cancelled     INT UNSIGNED  NOT NULL DEFAULT 0,
  duplicates    INT UNSIGNED  NOT NULL DEFAULT 0,
  rejected      INT UNSIGNED  NOT NULL DEFAULT 0,
  report        TEXT          NULL,
  created_by    INT           NULL,
  created_at    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mc_imports_channel (channel_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS mc_settlements (
  id                  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  channel_id          INT UNSIGNED  NOT NULL,
  period_from         CHAR(10)      NOT NULL,
  period_to           CHAR(10)      NOT NULL,
  reference           VARCHAR(120)  NULL,
  sales_count         INT UNSIGNED  NOT NULL DEFAULT 0,
  expected_net_cents  INT           NOT NULL DEFAULT 0,
  received_cents      INT           NULL,
  note                VARCHAR(500)  NULL,
  created_by          INT           NULL,
  created_at          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_mc_settlements_channel (channel_id, period_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
