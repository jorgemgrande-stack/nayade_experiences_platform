-- Ski Net · Alquiler v1 por unidad (módulo del SDK, server/skiRental): ajustes por sede (tipos de material y texto del
-- contrato), tiendas con horario, modelos, unidades con código y estado, historial de cada unidad, entregas y
-- devoluciones por unidad, contratos firmados por clic y taller. Aditiva: las tablas v0.1 (ski_rental_sites, _items,
-- _rentals) se conservan sin cambios. Nada se borra desde el código: se archiva, se cierra o se retira.
CREATE TABLE IF NOT EXISTS ski_rental_settings (
  site_id        VARCHAR(63)  NOT NULL,
  asset_types    JSON         NULL,
  contract_terms TEXT         NULL,
  terms_version  INT UNSIGNED NOT NULL DEFAULT 1,
  unit_seq       INT UNSIGNED NOT NULL DEFAULT 0,
  updated_by     VARCHAR(100) NULL,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_stores (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id             VARCHAR(63)  NOT NULL,
  name                VARCHAR(120) NOT NULL,
  opening_time        CHAR(5)      NOT NULL,
  closing_time        CHAR(5)      NOT NULL,
  overdue_return_time CHAR(5)      NOT NULL,
  active              TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_rental_stores_site_name (site_id, name),
  CONSTRAINT chk_ski_rental_stores_hours CHECK (closing_time > opening_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_models (
  id                      INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id                 VARCHAR(63)  NOT NULL,
  asset_type              VARCHAR(24)  NOT NULL,
  name                    VARCHAR(120) NOT NULL,
  brand                   VARCHAR(80)  NULL,
  size                    VARCHAR(16)  NOT NULL DEFAULT '',
  replacement_value_cents INT UNSIGNED NULL,
  active                  TINYINT(1)   NOT NULL DEFAULT 1,
  created_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_rental_models_site_model (site_id, asset_type, name, size)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_units (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id    VARCHAR(63)  NOT NULL,
  model_id   INT UNSIGNED NOT NULL,
  store_id   INT UNSIGNED NULL,
  code       VARCHAR(40)  NOT NULL,
  status     VARCHAR(16)  NOT NULL DEFAULT 'available',
  notes      VARCHAR(500) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_rental_units_site_code (site_id, code),
  KEY idx_ski_rental_units_site_status (site_id, status),
  KEY idx_ski_rental_units_model_status (model_id, status),
  CONSTRAINT fk_ski_rental_units_model FOREIGN KEY (model_id) REFERENCES ski_rental_models (id),
  CONSTRAINT fk_ski_rental_units_store FOREIGN KEY (store_id) REFERENCES ski_rental_stores (id),
  CONSTRAINT chk_ski_rental_units_status CHECK (status IN ('available', 'rented', 'workshop', 'incident', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_unit_events (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id     VARCHAR(63)  NOT NULL,
  unit_id     INT UNSIGNED NOT NULL,
  from_status VARCHAR(16)  NULL,
  to_status   VARCHAR(16)  NOT NULL,
  kind        VARCHAR(24)  NOT NULL,
  ref_id      INT UNSIGNED NULL,
  note        VARCHAR(300) NULL,
  actor       VARCHAR(100) NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ski_rental_unit_events_unit (unit_id, id),
  KEY idx_ski_rental_unit_events_site (site_id, created_at),
  CONSTRAINT fk_ski_rental_unit_events_unit FOREIGN KEY (unit_id) REFERENCES ski_rental_units (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_deliveries (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id              VARCHAR(63)  NOT NULL,
  store_id             INT UNSIGNED NOT NULL,
  customer_name        VARCHAR(120) NOT NULL,
  reservation_id       INT          NULL,
  start_date           DATE         NOT NULL,
  expected_return_date DATE         NOT NULL,
  status               VARCHAR(16)  NOT NULL DEFAULT 'open',
  created_by           VARCHAR(100) NULL,
  created_at           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_at            TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  KEY idx_ski_rental_deliveries_site_status (site_id, status, expected_return_date),
  KEY idx_ski_rental_deliveries_site_reservation (site_id, reservation_id),
  CONSTRAINT fk_ski_rental_deliveries_store FOREIGN KEY (store_id) REFERENCES ski_rental_stores (id),
  CONSTRAINT chk_ski_rental_deliveries_dates CHECK (expected_return_date >= start_date),
  CONSTRAINT chk_ski_rental_deliveries_status CHECK (status IN ('open', 'returned'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_delivery_lines (
  id                   INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id              VARCHAR(63)  NOT NULL,
  delivery_id          INT UNSIGNED NOT NULL,
  unit_id              INT UNSIGNED NOT NULL,
  requested_type       VARCHAR(24)  NOT NULL,
  requested_size       VARCHAR(16)  NULL,
  size_mismatch_reason VARCHAR(200) NULL,
  returned_at          TIMESTAMP(3) NULL,
  return_condition     VARCHAR(16)  NULL,
  return_note          VARCHAR(300) NULL,
  -- Una unidad solo puede estar en una línea sin devolver: garantía en la propia BD
  open_unit_id         INT UNSIGNED GENERATED ALWAYS AS (IF(returned_at IS NULL, unit_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_rental_delivery_lines_open_unit (open_unit_id),
  KEY idx_ski_rental_delivery_lines_delivery (delivery_id),
  KEY idx_ski_rental_delivery_lines_site (site_id, returned_at),
  CONSTRAINT fk_ski_rental_delivery_lines_delivery FOREIGN KEY (delivery_id) REFERENCES ski_rental_deliveries (id),
  CONSTRAINT fk_ski_rental_delivery_lines_unit FOREIGN KEY (unit_id) REFERENCES ski_rental_units (id),
  CONSTRAINT chk_ski_rental_delivery_lines_condition CHECK (return_condition IS NULL OR return_condition IN ('ok', 'damaged', 'lost'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_contracts (
  id                INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id           VARCHAR(63)  NOT NULL,
  delivery_id       INT UNSIGNED NOT NULL,
  status            VARCHAR(16)  NOT NULL DEFAULT 'pending',
  terms_version     INT UNSIGNED NOT NULL,
  content           MEDIUMTEXT   NOT NULL,
  content_hash      CHAR(64)     NOT NULL,
  signer_name       VARCHAR(120) NULL,
  signed_at         TIMESTAMP(3) NULL,
  signed_ip         VARCHAR(64)  NULL,
  signed_user_agent VARCHAR(300) NULL,
  signed_by         VARCHAR(100) NULL,
  created_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_rental_contracts_delivery (delivery_id),
  KEY idx_ski_rental_contracts_site_status (site_id, status),
  CONSTRAINT fk_ski_rental_contracts_delivery FOREIGN KEY (delivery_id) REFERENCES ski_rental_deliveries (id),
  CONSTRAINT chk_ski_rental_contracts_status CHECK (status IN ('pending', 'signed'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_workshop_tickets (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id    VARCHAR(63)  NOT NULL,
  unit_id    INT UNSIGNED NOT NULL,
  reason     VARCHAR(300) NOT NULL,
  status     VARCHAR(16)  NOT NULL DEFAULT 'open',
  resolution VARCHAR(16)  NULL,
  notes      VARCHAR(500) NULL,
  created_by VARCHAR(100) NULL,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  closed_by  VARCHAR(100) NULL,
  closed_at  TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  KEY idx_ski_rental_workshop_site_status (site_id, status),
  KEY idx_ski_rental_workshop_unit (unit_id, status),
  CONSTRAINT fk_ski_rental_workshop_unit FOREIGN KEY (unit_id) REFERENCES ski_rental_units (id),
  CONSTRAINT chk_ski_rental_workshop_status CHECK (status IN ('open', 'done')),
  CONSTRAINT chk_ski_rental_workshop_resolution CHECK (resolution IS NULL OR resolution IN ('available', 'incident', 'retired'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
