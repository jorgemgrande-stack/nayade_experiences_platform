-- Big Elephant — condiciones comerciales personalizadas por cliente (aditiva). Diseño:
-- docs/elephant-source/CONDICIONES_PERSONALIZADAS.md.
--
-- `commercial_terms`: un ACUERDO negociado (una fila por versión) de una empresa: modo de precio (individual por
--   partida o cuota global), presentación al cliente (cuota global o desglose), vigencia (indefinida o temporal, con lo
--   que ocurre al vencer), aceptación contractual y resultado de sincronización. `subscription_id` NULL = borrador de
--   paquete para una contratación nueva. `revision` es la versión del borrador (dos administradores no se pisan).
-- `commercial_terms_lines`: partidas del acuerdo, de catálogo (con su precio oficial de referencia) o a medida (sin
--   producto: nunca conceden licencias). `line_ref` identifica la misma partida entre versiones del acuerdo (la clave
--   del producto o, en una partida a medida, una referencia generada). Cada guardado del borrador escribe una revisión nueva; nada se reescribe.
-- `commercial_terms_adjustments`: descuentos y recargos, porcentuales o fijos, por partida o globales, recurrentes o
--   de un solo uso.
-- `commercial_terms_events`: historial inmutable (solo inserciones) con motivo obligatorio, valores anteriores y
--   nuevos, fecha efectiva, estado de aceptación, resultado de sincronización y efecto económico.
-- `subscription_items`: la partida materializada de un acuerdo guarda de cuál viene y su importe neto del periodo
--   (`line_amount_cents`: una cuota global repartida no siempre da un unitario entero). NULL = como hasta ahora.
-- Nunca se ejecuta al arrancar.

CREATE TABLE commercial_terms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  subscription_id INT NULL,
  version_no INT NOT NULL DEFAULT 1,
  status ENUM('draft','pending_acceptance','scheduled','active','superseded','cancelled','expired') NOT NULL DEFAULT 'draft',
  pricing_mode ENUM('per_item','global') NOT NULL,
  global_amount_cents BIGINT NULL,
  billing_interval ENUM('month','year') NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  presentation ENUM('global','breakdown') NOT NULL DEFAULT 'breakdown',
  package_name VARCHAR(160) NULL,
  conditions TEXT NULL,
  effective_from BIGINT NULL,
  effective_to BIGINT NULL,
  after_end ENUM('official_snapshot','official_current','next_terms') NULL,
  next_terms_id INT NULL,
  requires_acceptance TINYINT(1) NOT NULL DEFAULT 0,
  acceptance_status ENUM('not_required','pending','accepted','rejected','expired') NOT NULL DEFAULT 'not_required',
  contract_id INT NULL,
  contract_version INT NULL,
  acceptance_id INT NULL,
  reason VARCHAR(500) NOT NULL,
  revision INT NOT NULL DEFAULT 1,
  summary_json JSON NULL,
  input_hash CHAR(64) NULL,
  sync_status ENUM('none','pending','synced','failed') NOT NULL DEFAULT 'none',
  sync_detail JSON NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NULL,
  updated_by VARCHAR(100) NULL,
  activated_at BIGINT NULL,
  activated_by VARCHAR(100) NULL,
  closed_at BIGINT NULL,
  KEY idx_terms_subscription (subscription_id, status),
  KEY idx_terms_company (company_id, status),
  KEY idx_terms_next (next_terms_id),
  CONSTRAINT fk_terms_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT fk_terms_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id),
  CONSTRAINT fk_terms_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts (id),
  CONSTRAINT fk_terms_next FOREIGN KEY (next_terms_id) REFERENCES commercial_terms (id),
  CONSTRAINT chk_terms_global CHECK ((pricing_mode = 'global' AND global_amount_cents >= 0) OR (pricing_mode = 'per_item' AND global_amount_cents IS NULL)),
  CONSTRAINT chk_terms_window CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to > effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commercial_terms_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  terms_id INT NOT NULL,
  revision INT NOT NULL,
  line_kind ENUM('catalog','custom') NOT NULL,
  line_ref VARCHAR(80) NOT NULL,
  concept VARCHAR(30) NOT NULL,
  product_key VARCHAR(80) NULL,
  price_id INT NULL,
  catalog_json JSON NULL,
  name VARCHAR(160) NOT NULL,
  description TEXT NULL,
  conditions TEXT NULL,
  charge_class ENUM('recurring','initial','extraordinary') NOT NULL,
  quantity INT NOT NULL DEFAULT 1,
  official_unit_cents BIGINT NULL,
  negotiated_unit_cents BIGINT NULL,
  tax_rate_bp INT NOT NULL,
  starts_at BIGINT NULL,
  ends_at BIGINT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  KEY idx_terms_line (terms_id, revision, sort_order),
  CONSTRAINT fk_terms_line_terms FOREIGN KEY (terms_id) REFERENCES commercial_terms (id),
  CONSTRAINT fk_terms_line_price FOREIGN KEY (price_id) REFERENCES web_prices (id),
  CONSTRAINT chk_terms_line_quantity CHECK (quantity >= 1),
  CONSTRAINT chk_terms_line_amounts CHECK ((official_unit_cents IS NULL OR official_unit_cents >= 0) AND (negotiated_unit_cents IS NULL OR negotiated_unit_cents >= 0)),
  CONSTRAINT chk_terms_line_custom CHECK (line_kind = 'catalog' OR (product_key IS NULL AND price_id IS NULL AND catalog_json IS NULL AND official_unit_cents IS NULL))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commercial_terms_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  terms_id INT NOT NULL,
  revision INT NOT NULL,
  line_id INT NULL,
  adjustment_type ENUM('discount','surcharge') NOT NULL,
  adjustment_mode ENUM('percent','amount') NOT NULL,
  value BIGINT NOT NULL,
  recurrence ENUM('recurring','once') NOT NULL,
  ends_at BIGINT NULL,
  note VARCHAR(200) NULL,
  KEY idx_terms_adjustment (terms_id, revision),
  CONSTRAINT fk_terms_adjustment_terms FOREIGN KEY (terms_id) REFERENCES commercial_terms (id),
  CONSTRAINT fk_terms_adjustment_line FOREIGN KEY (line_id) REFERENCES commercial_terms_lines (id),
  CONSTRAINT chk_terms_adjustment_value CHECK (value >= 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commercial_terms_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  terms_id INT NOT NULL,
  company_id INT NOT NULL,
  subscription_id INT NULL,
  kind VARCHAR(40) NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(500) NOT NULL,
  actor VARCHAR(100) NOT NULL,
  effective_at BIGINT NULL,
  acceptance_status VARCHAR(20) NULL,
  sync_result VARCHAR(20) NULL,
  economic_json JSON NULL,
  created_at BIGINT NOT NULL,
  KEY idx_terms_event_terms (terms_id, id),
  KEY idx_terms_event_subscription (subscription_id, id),
  KEY idx_terms_event_company (company_id, id),
  CONSTRAINT fk_terms_event_terms FOREIGN KEY (terms_id) REFERENCES commercial_terms (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE subscription_items
  ADD COLUMN terms_id INT NULL,
  ADD COLUMN terms_line_id INT NULL,
  ADD COLUMN line_amount_cents BIGINT NULL,
  ADD KEY idx_item_terms (terms_id),
  ADD CONSTRAINT fk_item_terms FOREIGN KEY (terms_id) REFERENCES commercial_terms (id);
