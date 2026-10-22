-- Big Elephant — orquestador comercial de la contratación (aditiva). Un pedido recorre
-- solicitud → cotización → contrato → confirmación → suscripción → licencias → activación con estados
-- explícitos, eventos y claves de idempotencia. Los pagos son SOLO de prueba (mode = 'test').
-- Nunca se ejecuta al arrancar. Diseño: docs/architecture/ORQUESTADOR_CONTRATACION.md.

CREATE TABLE commercial_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reference VARCHAR(32) NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  -- Huella de la petición: la misma clave con otro contenido se rechaza
  payload_hash CHAR(64) NOT NULL,
  kind ENUM('new','trial_conversion','change') NOT NULL,
  state ENUM('requested','quoted','contracted','confirmed','subscribed','licensed','active','past_due','suspended','cancel_scheduled','cancelled','superseded','rejected') NOT NULL,
  company_id INT NOT NULL,
  lead_request_id INT NULL,
  -- Prueba de origen (sin clave foránea: la tabla de pruebas se puede revertir por separado; la valida el servicio)
  trial_id INT NULL,
  previous_order_id INT NULL,
  request_json JSON NOT NULL,
  quote_json JSON NULL,
  contract_id INT NULL,
  subscription_id INT NULL,
  tenant_id VARCHAR(63) NULL,
  -- Base de la activación: pago verificado, aprobación administrativa o herencia (cambio sin importe)
  confirmation_json JSON NULL,
  grace_ends_at BIGINT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error VARCHAR(300) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NULL,
  updated_by VARCHAR(100) NULL,
  -- Un solo pedido de alta/conversión abierto por empresa y un solo cambio en curso por suscripción
  open_company_id INT GENERATED ALWAYS AS (IF(kind <> 'change' AND state NOT IN ('cancelled','superseded','rejected'), company_id, NULL)) STORED,
  pending_change_subscription_id INT GENERATED ALWAYS AS (IF(kind = 'change' AND state IN ('requested','quoted','contracted','confirmed','subscribed','licensed'), subscription_id, NULL)) STORED,
  UNIQUE KEY uq_order_idempotency (idempotency_key),
  UNIQUE KEY uq_order_reference (reference),
  UNIQUE KEY uq_order_open_company (open_company_id),
  UNIQUE KEY uq_order_pending_change (pending_change_subscription_id),
  KEY idx_order_state (state, updated_at),
  KEY idx_order_company (company_id),
  KEY idx_order_subscription (subscription_id),
  KEY idx_order_trial (trial_id),
  CONSTRAINT fk_order_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT fk_order_lead_request FOREIGN KEY (lead_request_id) REFERENCES crm_lead_requests (id),
  CONSTRAINT fk_order_previous FOREIGN KEY (previous_order_id) REFERENCES commercial_orders (id),
  CONSTRAINT fk_order_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts (id),
  CONSTRAINT fk_order_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commercial_order_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  kind VARCHAR(40) NOT NULL,
  from_state VARCHAR(30) NULL,
  to_state VARCHAR(30) NOT NULL,
  version INT NOT NULL,
  detail_json JSON NULL,
  actor VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_order_event (order_id, id),
  CONSTRAINT fk_order_event FOREIGN KEY (order_id) REFERENCES commercial_orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Pagos de PRUEBA: idempotentes por clave; nunca un cobro real (mode solo admite 'test')
CREATE TABLE commercial_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  idempotency_key VARCHAR(120) NOT NULL,
  purpose ENUM('initial','change','renewal') NOT NULL,
  period_start BIGINT NULL,
  amount_cents INT NOT NULL,
  currency CHAR(3) NOT NULL,
  status ENUM('pending','succeeded','failed') NOT NULL,
  provider VARCHAR(20) NOT NULL,
  mode ENUM('test') NOT NULL DEFAULT 'test',
  provider_ref VARCHAR(120) NULL,
  due_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  settled_at BIGINT NULL,
  UNIQUE KEY uq_payment_key (idempotency_key),
  KEY idx_payment_order (order_id, id),
  CONSTRAINT fk_payment_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Eventos firmados del proveedor de pruebas: cada uno se registra UNA vez, con su efecto
CREATE TABLE commercial_payment_events (
  provider_event_id VARCHAR(120) NOT NULL PRIMARY KEY,
  payment_id INT NULL,
  type VARCHAR(40) NOT NULL,
  outcome ENUM('applied','ignored','rejected') NOT NULL,
  detail VARCHAR(200) NULL,
  received_at BIGINT NOT NULL,
  KEY idx_payment_event_payment (payment_id),
  CONSTRAINT fk_payment_event_payment FOREIGN KEY (payment_id) REFERENCES commercial_payments (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
