-- Big Elephant — Servicios recurrentes de clientes externos (aditiva, base del CRM).
--
-- Clientes con tecnología propia (fuera de Elephant Core) cuyo servicio se contrata, se acepta y se cobra desde el CRM
-- con Stripe Billing. Nunca se aprovisiona nada en Elephant Core.
--
-- `external_subscriptions`: una por contrato. Servicio, importe neto, IVA, calendario (día de cobro, hora y zona) y
--   primer vencimiento; enlace con Stripe (Customer, sesión de autorización del método de pago, suscripción, reloj de
--   pruebas). Solo el id del método de pago, nunca datos de la tarjeta.
-- `crm_contract_acceptances`: aceptación digital del contrato. Token de un solo uso (solo su hash), versión y huella del
--   documento aceptado, identidad declarada del firmante, fecha, IP seudonimizada y agente de usuario.
-- `external_subscription_events`: historial; cada evento de Stripe (factura cobrada, fallida…) una sola vez.
-- Sin estas tablas el plano de control funciona igual: la contratación externa no se monta.

CREATE TABLE external_subscriptions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  contract_id BIGINT UNSIGNED NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  service_key VARCHAR(64) NOT NULL,
  service_name VARCHAR(160) NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL,
  tax_rate_bp INT UNSIGNED NOT NULL,
  billing_interval VARCHAR(8) NOT NULL,
  billing_day TINYINT UNSIGNED NOT NULL,
  billing_hour TINYINT UNSIGNED NOT NULL,
  timezone VARCHAR(40) NOT NULL,
  grace_days TINYINT UNSIGNED NOT NULL,
  first_charge_at BIGINT NOT NULL,
  external_ref VARCHAR(200) NULL,
  status VARCHAR(32) NOT NULL,
  stripe_customer_id VARCHAR(64) NULL,
  stripe_setup_session_id VARCHAR(100) NULL,
  stripe_payment_method_id VARCHAR(64) NULL,
  stripe_subscription_id VARCHAR(64) NULL,
  stripe_test_clock_id VARCHAR(64) NULL,
  last_invoice_id VARCHAR(64) NULL,
  last_invoice_status VARCHAR(24) NULL,
  current_period_start BIGINT NULL,
  current_period_end BIGINT NULL,
  grace_until BIGINT NULL,
  decision_reason VARCHAR(300) NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_external_contract (contract_id),
  UNIQUE KEY uq_external_stripe_subscription (stripe_subscription_id),
  UNIQUE KEY uq_external_setup_session (stripe_setup_session_id),
  KEY ix_external_company (company_id),
  KEY ix_external_status (status),
  CONSTRAINT ck_external_livemode CHECK (livemode IN (0, 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE crm_contract_acceptances (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contract_id BIGINT UNSIGNED NOT NULL,
  contract_version INT UNSIGNED NOT NULL,
  document_sha256 CHAR(64) NOT NULL,
  token_sha256 CHAR(64) NOT NULL,
  status VARCHAR(16) NOT NULL,
  signer_name VARCHAR(160) NOT NULL,
  signer_email VARCHAR(254) NOT NULL,
  signer_role VARCHAR(120) NULL,
  signer_tax_id VARCHAR(32) NULL,
  accepted_name VARCHAR(160) NULL,
  accepted_tax_id VARCHAR(32) NULL,
  accepted_at BIGINT NULL,
  accepted_ip_hash CHAR(64) NULL,
  accepted_user_agent VARCHAR(300) NULL,
  consent_text TEXT NULL,
  expires_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_acceptance_token (token_sha256),
  KEY ix_acceptance_contract (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE external_subscription_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  external_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(40) NOT NULL,
  ref VARCHAR(100) NULL,
  detail_json JSON NULL,
  actor VARCHAR(100) NOT NULL,
  at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_external_event_ref (external_id, kind, ref),
  KEY ix_external_event (external_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
