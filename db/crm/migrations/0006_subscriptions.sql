-- Big Elephant — Suscripciones v1 con precios contratados y facturación en MODO SOMBRA (aditiva).
-- Diseño: docs/architecture/SUSCRIPCIONES_PRECIOS_CONTRATADOS.md. Misma BD que contratos (crm_contracts)
-- y catálogo (web_prices): claves foráneas reales y aceptación de precio + alta en una transacción.
-- NADA de esto cobra, emite facturas fiscales ni concede licencias: el modo es siempre «shadow».

CREATE TABLE subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(32) NULL,
  company_id INT NOT NULL,
  contract_id INT NULL,
  tenant_id VARCHAR(63) NULL,
  status ENUM('trialing','active','canceled') NOT NULL,
  -- Único modo permitido en v1: se calcula y registra, nunca se cobra
  mode ENUM('shadow') NOT NULL DEFAULT 'shadow',
  currency CHAR(3) NOT NULL,
  billing_interval ENUM('month','year') NOT NULL,
  -- Cambio de periodicidad programado para la próxima renovación
  pending_interval ENUM('month','year') NULL,
  started_at BIGINT NOT NULL,
  -- Día del mes (UTC) al que se anclan las renovaciones: un alta el 31 renueva el 30/28 y vuelve al 31
  anchor_day TINYINT NOT NULL,
  current_period_start BIGINT NOT NULL,
  current_period_end BIGINT NOT NULL,
  trial_end BIGINT NULL,
  cancel_at BIGINT NULL,
  canceled_at BIGINT NULL,
  -- Concurrencia optimista: cada cambio exige la versión leída
  version INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NULL,
  updated_by VARCHAR(100) NULL,
  -- Una sola suscripción viva por contrato (columna generada: NULL si está cancelada)
  live_contract_id INT GENERATED ALWAYS AS (IF(status <> 'canceled', contract_id, NULL)) STORED,
  UNIQUE KEY uq_subscription_reference (reference),
  UNIQUE KEY uq_subscription_live_contract (live_contract_id),
  KEY idx_subscription_company (company_id),
  KEY idx_subscription_status (status, current_period_end),
  CONSTRAINT fk_subscription_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT fk_subscription_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Partidas contratadas: instantánea INMUTABLE de las condiciones aceptadas. Un cambio cierra la
-- partida (effective_to) y crea otra; el importe nunca se actualiza.
CREATE TABLE subscription_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  family ENUM('core_plan','extension','industry_module','usage','service') NOT NULL,
  product_key VARCHAR(80) NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  activation_kind VARCHAR(20) NOT NULL,
  activation_ref VARCHAR(64) NULL,
  -- Versión de precio aceptada (web_prices.id); NULL solo si el origen es un contrato o revisión manual
  price_id INT NULL,
  price_source ENUM('catalog','contract','manual_review') NOT NULL,
  price_kind ENUM('monthly','yearly','one_time','usage') NOT NULL,
  unit_amount_cents BIGINT NOT NULL,
  unit VARCHAR(40) NULL,
  quantity INT NOT NULL DEFAULT 1,
  tax_rate_bp INT NOT NULL,
  tax_included TINYINT(1) NOT NULL DEFAULT 0,
  discount_kind ENUM('percent','amount') NULL,
  discount_value INT NULL,
  discount_ends_at BIGINT NULL,
  discount_note VARCHAR(200) NULL,
  effective_from BIGINT NOT NULL,
  effective_to BIGINT NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  KEY idx_item_subscription (subscription_id, effective_from),
  CONSTRAINT fk_item_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id),
  CONSTRAINT fk_item_price FOREIGN KEY (price_id) REFERENCES web_prices (id),
  CONSTRAINT chk_item_amount CHECK (unit_amount_cents >= 0),
  CONSTRAINT chk_item_quantity CHECK (quantity >= 1),
  CONSTRAINT chk_item_window CHECK (effective_to IS NULL OR effective_to >= effective_from)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historial contractual (solo inserciones desde el código)
CREATE TABLE subscription_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  kind VARCHAR(40) NOT NULL,
  version INT NOT NULL,
  before_json JSON NULL,
  after_json JSON NULL,
  reason VARCHAR(500) NULL,
  actor VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_event_subscription (subscription_id, id),
  CONSTRAINT fk_event_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Consumos: la misma lectura (clave de idempotencia) cuenta una sola vez
CREATE TABLE subscription_usage (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  period_start BIGINT NOT NULL,
  quantity BIGINT NOT NULL,
  source VARCHAR(40) NOT NULL,
  idempotency_key VARCHAR(128) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_usage_idem (idempotency_key),
  KEY idx_usage_item_period (item_id, period_start),
  CONSTRAINT fk_usage_item FOREIGN KEY (item_id) REFERENCES subscription_items (id),
  CONSTRAINT chk_usage_quantity CHECK (quantity >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Facturas SOMBRA: cálculo registrado, nunca emitido ni cobrado. Una por suscripción, tipo,
-- periodo y concepto (dedupe_key: '' en renovación; id de partida en prorrateos y servicios).
CREATE TABLE shadow_invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  kind ENUM('renewal','proration','one_time','usage') NOT NULL,
  period_start BIGINT NOT NULL,
  period_end BIGINT NOT NULL,
  dedupe_key VARCHAR(40) NOT NULL DEFAULT '',
  currency CHAR(3) NOT NULL,
  subtotal_cents BIGINT NOT NULL,
  discount_cents BIGINT NOT NULL,
  tax_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  lines_json JSON NOT NULL,
  -- Huella de las entradas del cálculo: recalcular el mismo periodo debe dar la misma
  input_hash CHAR(64) NOT NULL,
  -- Comparación con el importe del contrato del CRM (si lo hay)
  contract_amount_cents BIGINT NULL,
  contract_diff_cents BIGINT NULL,
  payment_status ENUM('none','pending','paid','failed','review') NOT NULL DEFAULT 'none',
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_shadow_invoice (subscription_id, kind, period_start, dedupe_key),
  CONSTRAINT fk_shadow_invoice_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Intentos de cobro SIMULADOS: la clave de idempotencia es de la factura y no cambia entre reintentos
CREATE TABLE shadow_charges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_id INT NOT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  attempt INT NOT NULL,
  status ENUM('pending','processing','succeeded','failed','unknown') NOT NULL,
  provider_ref VARCHAR(120) NULL,
  error VARCHAR(200) NULL,
  created_at BIGINT NOT NULL,
  settled_at BIGINT NULL,
  UNIQUE KEY uq_shadow_charge_attempt (invoice_id, attempt),
  KEY idx_shadow_charge_key (idempotency_key),
  CONSTRAINT fk_shadow_charge_invoice FOREIGN KEY (invoice_id) REFERENCES shadow_invoices (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Webhooks SIMULADOS: el evento se marca procesado en la misma transacción que su efecto
CREATE TABLE shadow_webhook_events (
  provider_event_id VARCHAR(255) NOT NULL PRIMARY KEY,
  status ENUM('processing','processed','failed') NOT NULL,
  received_at BIGINT NOT NULL,
  processed_at BIGINT NULL,
  error VARCHAR(200) NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
