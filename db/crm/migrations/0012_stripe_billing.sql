-- Big Elephant — Stripe Billing (aditiva). SOLO MODO PRUEBAS: cada fila con datos de Stripe exige
-- livemode = 0 en la propia BD, como `commercial_payments.mode` solo admite 'test'.
--
-- Reparto de responsabilidades:
--  - Stripe es la fuente de verdad del COBRO (suscripción, facturas, métodos de pago).
--  - El plano de control es la fuente de verdad del ACCESO (licencias) y del estado de la empresa.
--  - Estas tablas son la correspondencia y una copia local para auditar y conciliar. Se pueden
--    reconstruir desde la API de Stripe.
--
-- Los identificadores de Stripe distinguen mayúsculas: sus columnas usan utf8mb4_bin (comparación exacta).
--
-- Nunca se ejecuta al arrancar. Diseño: docs/elephant-source/STRIPE_FASE_A.md.

-- Correspondencia precio aprobado del catálogo ↔ Product/Price de Stripe. El importe vive en
-- web_prices; en Stripe un Price no cambia de importe: un precio nuevo es otra fila.
CREATE TABLE stripe_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  web_price_id INT NOT NULL,
  stripe_product_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  stripe_price_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- lookup_key de Stripe (exclusiva en la cuenta): es:<producto>:<kind>:<moneda>:v<web_price_id>
  lookup_key VARCHAR(200) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('active','archived') NOT NULL DEFAULT 'active',
  created_at BIGINT NOT NULL,
  synced_at BIGINT NOT NULL,
  UNIQUE KEY uq_stripe_price_web (web_price_id),
  UNIQUE KEY uq_stripe_price_id (stripe_price_id),
  UNIQUE KEY uq_stripe_price_lookup (lookup_key),
  CONSTRAINT fk_stripe_price_web FOREIGN KEY (web_price_id) REFERENCES web_prices (id),
  CONSTRAINT chk_stripe_price_test CHECK (livemode = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Un Customer de Stripe por empresa del CRM, resuelto SIEMPRE en el servidor (nunca desde el
-- navegador). El tenant se rellena cuando la empresa tiene instalación.
CREATE TABLE stripe_customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT NOT NULL,
  tenant_id VARCHAR(63) NULL,
  stripe_customer_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NULL,
  UNIQUE KEY uq_stripe_customer_company (company_id),
  UNIQUE KEY uq_stripe_customer_id (stripe_customer_id),
  UNIQUE KEY uq_stripe_customer_tenant (tenant_id),
  CONSTRAINT fk_stripe_customer_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT chk_stripe_customer_test CHECK (livemode = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Sesiones de Checkout de un pedido del orquestador. Como mucho una abierta por pedido; la URL no se
-- guarda (caduca y se vuelve a pedir a Stripe).
CREATE TABLE stripe_checkout_sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  stripe_session_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Clave enviada a Stripe en Idempotency-Key (sin datos personales)
  idempotency_key VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  -- Precios de Stripe enviados (calculados en el servidor a partir del pedido)
  price_ids_json JSON NOT NULL,
  status ENUM('open','complete','expired') NOT NULL,
  payment_status VARCHAR(30) NULL,
  expires_at BIGINT NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  completed_at BIGINT NULL,
  open_order_id INT GENERATED ALWAYS AS (IF(status = 'open', order_id, NULL)) STORED,
  UNIQUE KEY uq_stripe_checkout_session (stripe_session_id),
  UNIQUE KEY uq_stripe_checkout_key (idempotency_key),
  UNIQUE KEY uq_stripe_checkout_open (open_order_id),
  KEY idx_stripe_checkout_order (order_id, id),
  CONSTRAINT fk_stripe_checkout_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_stripe_checkout_test CHECK (livemode = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Copia local de cada Subscription de Stripe, actualizada SOLO con el objeto releído desde la API
-- (nunca con el cuerpo de un evento: los eventos llegan desordenados o repetidos).
CREATE TABLE stripe_subscriptions (
  stripe_subscription_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  stripe_customer_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  company_id INT NOT NULL,
  order_id INT NULL,
  tenant_id VARCHAR(63) NULL,
  status ENUM('incomplete','incomplete_expired','trialing','active','past_due','canceled','unpaid','paused') NOT NULL,
  -- En billing mode «flexible» la cancelación programada se refleja en cancel_at
  cancel_at BIGINT NULL,
  cancel_at_period_end TINYINT(1) NOT NULL DEFAULT 0,
  -- Desde la API 2025-03-31 el periodo está en los items: se guarda el máximo de items.data[].current_period_end
  current_period_end BIGINT NULL,
  latest_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  price_ids_json JSON NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  synced_at BIGINT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  KEY idx_stripe_sub_company (company_id),
  KEY idx_stripe_sub_order (order_id),
  KEY idx_stripe_sub_status (status, synced_at),
  CONSTRAINT fk_stripe_sub_customer FOREIGN KEY (stripe_customer_id) REFERENCES stripe_customers (stripe_customer_id),
  CONSTRAINT fk_stripe_sub_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT fk_stripe_sub_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_stripe_sub_test CHECK (livemode = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Eventos de Stripe recibidos (webhook) o recuperados (conciliación). Cada event.id se registra UNA
-- vez y se procesa de forma duradera: received → processing → processed | ignored | failed (se
-- reintenta con espera). El cuerpo NO se guarda: el efecto se calcula releyendo el objeto en Stripe.
CREATE TABLE stripe_events (
  event_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  type VARCHAR(80) NOT NULL,
  api_version VARCHAR(40) NULL,
  object_type VARCHAR(40) NULL,
  object_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  -- Momento de creación según Stripe (segundos): solo informativo, no se usa para ordenar
  stripe_created BIGINT NOT NULL,
  source ENUM('webhook','reconcile') NOT NULL,
  status ENUM('received','processing','processed','ignored','failed') NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NULL,
  locked_until BIGINT NULL,
  last_error VARCHAR(300) NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  received_at BIGINT NOT NULL,
  processed_at BIGINT NULL,
  KEY idx_stripe_event_due (status, next_attempt_at),
  KEY idx_stripe_event_claim (status, received_at),
  KEY idx_stripe_event_object (object_id),
  CONSTRAINT chk_stripe_event_test CHECK (livemode = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Estado de las tareas de conciliación (p. ej. último evento revisado) y su bloqueo entre réplicas.
CREATE TABLE stripe_sync_state (
  name VARCHAR(60) NOT NULL PRIMARY KEY,
  value_json JSON NOT NULL,
  locked_until BIGINT NULL,
  updated_at BIGINT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Reembolsos y disputas de los cargos de una suscripción de Elephant Source, releídos SIEMPRE en Stripe.
-- `coverage_lost = 1` (reembolso total o disputa perdida) retiene el pedido: queda suspendido (nunca se
-- borra nada) y no se reactiva solo hasta que haya un pago nuevo, se gane la disputa o un operador lo
-- resuelva con motivo (`resolved_at`, `resolution`). Un reembolso parcial o una disputa abierta solo avisan.
CREATE TABLE stripe_charge_adjustments (
  stripe_charge_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL PRIMARY KEY,
  stripe_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  stripe_subscription_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  order_id INT NOT NULL,
  company_id INT NOT NULL,
  amount_cents INT NOT NULL,
  amount_refunded_cents INT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL,
  dispute_status VARCHAR(40) NULL,
  coverage_lost TINYINT(1) NOT NULL DEFAULT 0,
  resolved_at BIGINT NULL,
  resolution VARCHAR(300) NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  KEY idx_stripe_adj_order (order_id, coverage_lost, resolved_at),
  CONSTRAINT fk_stripe_adj_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT fk_stripe_adj_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT chk_stripe_adj_test CHECK (livemode = 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
