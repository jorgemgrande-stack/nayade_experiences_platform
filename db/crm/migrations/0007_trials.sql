-- Big Elephant — prueba autónoma de 15 días: modelo de estados (aditiva). Preparación: NADA lo
-- ejecuta solo (sin suspensiones ni borrados automáticos) y no está conectado a ninguna API pública.
-- Diseño: docs/architecture/PRUEBA_AUTONOMA_15_DIAS.md.

CREATE TABLE trial_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  email_domain VARCHAR(253) NOT NULL,
  company_name VARCHAR(160) NOT NULL,
  -- Configuración elegida en la web (plan y complementos del catálogo publicado)
  configuration JSON NOT NULL,
  state ENUM('pending_verification','verified','provisioning','active','expired','suspended','converted','rejected','cancelled') NOT NULL,
  -- Solo el hash del token de verificación; el token en claro nunca se guarda
  verification_token_hash CHAR(64) NULL,
  verification_expires_at BIGINT NULL,
  verified_at BIGINT NULL,
  tenant_id VARCHAR(63) NULL,
  starts_at BIGINT NULL,
  ends_at BIGINT NULL,
  extensions_used INT NOT NULL DEFAULT 0,
  extension_requested_at BIGINT NULL,
  extension_reason VARCHAR(300) NULL,
  suspended_reason VARCHAR(300) NULL,
  converted_subscription_id INT NULL,
  idempotency_key VARCHAR(80) NOT NULL,
  ip_hash CHAR(64) NULL,
  version INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NULL,
  -- Una sola prueba abierta por correo (columna generada: NULL en estados terminales)
  open_email VARCHAR(254) GENERATED ALWAYS AS (IF(state IN ('converted','rejected','cancelled'), NULL, email)) STORED,
  UNIQUE KEY uq_trial_idempotency (idempotency_key),
  UNIQUE KEY uq_trial_open_email (open_email),
  UNIQUE KEY uq_trial_tenant (tenant_id),
  KEY idx_trial_state (state, ends_at),
  KEY idx_trial_domain (email_domain, created_at),
  KEY idx_trial_ip (ip_hash, created_at),
  CONSTRAINT fk_trial_subscription FOREIGN KEY (converted_subscription_id) REFERENCES subscriptions (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE trial_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  trial_id INT NOT NULL,
  action VARCHAR(40) NOT NULL,
  from_state VARCHAR(30) NULL,
  to_state VARCHAR(30) NOT NULL,
  version INT NOT NULL,
  detail VARCHAR(300) NULL,
  actor VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  KEY idx_trial_event (trial_id, id),
  CONSTRAINT fk_trial_event FOREIGN KEY (trial_id) REFERENCES trial_requests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
