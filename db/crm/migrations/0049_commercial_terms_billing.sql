-- Big Elephant — cobro en Stripe de las condiciones comerciales personalizadas (fase 4; aditiva). Diseño:
-- docs/elephant-source/CONDICIONES_PERSONALIZADAS.md.
--
-- `commercial_terms_billing`: UNA fila por suscripción que un operador ha puesto a cobrar en Stripe de forma expresa.
--   Es el segundo cerrojo del cobro: sin fila, la suscripción sigue en simulación aunque el interruptor esté encendido.
--   Guarda el Customer de la empresa (el mismo de `stripe_customers`), la sesión de Checkout pendiente (como mucho una
--   viva) con la huella de lo que ofrece, la suscripción de Stripe ya enlazada y su estado de cobro (al corriente,
--   impago con gracia, suspendida, cancelación programada, cancelada). `suspended_capabilities` recuerda qué licencias
--   suspendió el impago, para devolver solo esas al recuperarse el cobro.
-- `commercial_terms_billing_invoices`: facturas de Stripe de esas suscripciones (una fila por factura, releída siempre
--   en Stripe): estado, importes sin impuestos, impuesto, motivo y si el cobro quedó revertido.
-- Nunca se ejecuta al arrancar.

CREATE TABLE commercial_terms_billing (
  id INT AUTO_INCREMENT PRIMARY KEY,
  subscription_id INT NOT NULL,
  company_id INT NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('pending','active','past_due','suspended','cancel_scheduled','canceled','abandoned') NOT NULL DEFAULT 'pending',
  stripe_customer_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  stripe_subscription_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  session_id VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  session_status ENUM('open','complete','expired') NULL,
  session_expires_at BIGINT NULL,
  session_seq INT NOT NULL DEFAULT 0,
  checkout_json JSON NULL,
  stripe_status VARCHAR(32) NULL,
  current_period_end BIGINT NULL,
  cancel_at BIGINT NULL,
  grace_ends_at BIGINT NULL,
  read_only_until BIGINT NULL,
  last_paid_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  held_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  suspended_capabilities JSON NULL,
  started_by VARCHAR(100) NOT NULL,
  started_at BIGINT NOT NULL,
  linked_at BIGINT NULL,
  synced_at BIGINT NULL,
  updated_at BIGINT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  UNIQUE KEY uq_terms_billing_subscription (subscription_id),
  UNIQUE KEY uq_terms_billing_stripe_subscription (stripe_subscription_id),
  UNIQUE KEY uq_terms_billing_session (session_id),
  KEY idx_terms_billing_company (company_id),
  KEY idx_terms_billing_status (livemode, status, grace_ends_at),
  CONSTRAINT fk_terms_billing_subscription FOREIGN KEY (subscription_id) REFERENCES subscriptions (id),
  CONSTRAINT fk_terms_billing_company FOREIGN KEY (company_id) REFERENCES crm_companies (id),
  CONSTRAINT ck_terms_billing_livemode CHECK (livemode IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE commercial_terms_billing_invoices (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  billing_id INT NOT NULL,
  subscription_id INT NOT NULL,
  stripe_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  status VARCHAR(20) NOT NULL,
  billing_reason VARCHAR(40) NULL,
  invoice_number VARCHAR(60) NULL,
  currency CHAR(3) NOT NULL,
  subtotal_cents INT NULL,
  tax_cents INT NULL,
  total_cents INT NULL,
  amount_paid_cents INT NOT NULL DEFAULT 0,
  period_start BIGINT NULL,
  tax_check VARCHAR(40) NULL,
  coverage_lost TINYINT(1) NOT NULL DEFAULT 0,
  paid_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE KEY uq_terms_billing_invoice (stripe_invoice_id),
  KEY idx_terms_billing_invoice_billing (billing_id, id),
  CONSTRAINT fk_terms_billing_invoice_billing FOREIGN KEY (billing_id) REFERENCES commercial_terms_billing (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
