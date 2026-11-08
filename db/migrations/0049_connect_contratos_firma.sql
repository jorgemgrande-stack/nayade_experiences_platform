-- Contratos y firma electrónica (capacidad contracts-esign, server/contractsEsignDb.ts). BD de cada empresa; solo crea
-- tablas nuevas y vacías. Nunca se ejecuta al arrancar.
--
-- `esign_templates`: plantillas de contrato de la empresa (título y cuerpo con variables {{cliente.nombre}}, {{fecha}},
-- {{importe}}…). Cada cambio sube `version`; los contratos guardan el texto ya rellenado y la versión de la que salen.
-- `esign_contracts`: contrato para un cliente del CRM (opcionalmente con su presupuesto o reserva). Estados
-- draft → sent → signed | rejected, y void (anulado). Al enviarlo o firmarlo se fija el contenido con su huella
-- SHA-256 (content_hash); la firma guarda nombre, DNI/NIF opcional, fecha, IP, navegador y quién la recogió.
-- `esign_links`: enlaces de firma de un solo uso con token opaco (solo su huella), caducidad y estado
-- active | revoked | used. Un enlace activo por contrato (active_key, columna generada): emitir otro revoca el anterior.
-- `esign_events`: registro de evidencias del contrato (creado, enviado, abierto, firmado, rechazado, anulado, PDF…).
-- `esign_documents`: PDF del contrato firmado (uno por contrato) con su huella SHA-256.

CREATE TABLE IF NOT EXISTS esign_templates (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  title       VARCHAR(200)  NOT NULL,
  body        MEDIUMTEXT    NOT NULL,
  version     INT UNSIGNED  NOT NULL DEFAULT 1,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  created_by  INT           NOT NULL,
  created_at  BIGINT        NOT NULL,
  updated_by  INT           NOT NULL,
  updated_at  BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_esign_templates_active (is_active, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS esign_contracts (
  id                 INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  template_id        INT UNSIGNED   NULL DEFAULT NULL,
  template_version   INT UNSIGNED   NULL DEFAULT NULL,
  client_id          INT            NOT NULL,
  quote_id           INT            NULL DEFAULT NULL,
  reservation_id     INT            NULL DEFAULT NULL,
  title              VARCHAR(200)   NOT NULL,
  body               MEDIUMTEXT     NOT NULL,
  amount             DECIMAL(12,2)  NULL DEFAULT NULL,
  contract_date      CHAR(10)       NOT NULL,
  customer_name      VARCHAR(256)   NOT NULL,
  customer_email     VARCHAR(256)   NULL DEFAULT NULL,
  status             VARCHAR(16)    NOT NULL DEFAULT 'draft',
  content_json       MEDIUMTEXT     NULL,
  content_hash       CHAR(64)       NULL DEFAULT NULL,
  sent_at            BIGINT         NULL DEFAULT NULL,
  signer_name        VARCHAR(120)   NULL DEFAULT NULL,
  signer_tax_id      VARCHAR(20)    NULL DEFAULT NULL,
  signed_at          BIGINT         NULL DEFAULT NULL,
  signed_ip          VARCHAR(64)    NULL DEFAULT NULL,
  signed_user_agent  VARCHAR(300)   NULL DEFAULT NULL,
  signed_by          VARCHAR(100)   NULL DEFAULT NULL,
  signed_method      VARCHAR(16)    NULL DEFAULT NULL,
  closed_at          BIGINT         NULL DEFAULT NULL,
  closed_by          VARCHAR(100)   NULL DEFAULT NULL,
  close_reason       VARCHAR(500)   NULL DEFAULT NULL,
  created_by         INT            NOT NULL,
  created_at         BIGINT         NOT NULL,
  updated_at         BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_esign_contracts_status (status, id),
  KEY idx_esign_contracts_client (client_id, id),
  CONSTRAINT chk_esign_contracts_status CHECK (status IN ('draft', 'sent', 'signed', 'rejected', 'void')),
  CONSTRAINT chk_esign_contracts_method CHECK (signed_method IS NULL OR signed_method IN ('panel', 'link'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS esign_links (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  contract_id   INT UNSIGNED  NOT NULL,
  token_hash    CHAR(64)      NOT NULL,
  status        VARCHAR(16)   NOT NULL DEFAULT 'active',
  expires_at    BIGINT        NOT NULL,
  used_at       BIGINT        NULL DEFAULT NULL,
  created_by    VARCHAR(100)  NOT NULL,
  created_at    BIGINT        NOT NULL,
  revoked_at    BIGINT        NULL DEFAULT NULL,
  revoked_by    VARCHAR(100)  NULL DEFAULT NULL,
  active_key    INT UNSIGNED  GENERATED ALWAYS AS (IF(status = 'active', contract_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_esign_links_token (token_hash),
  UNIQUE KEY uq_esign_links_active (active_key),
  KEY idx_esign_links_contract (contract_id, id),
  CONSTRAINT chk_esign_links_status CHECK (status IN ('active', 'revoked', 'used'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS esign_events (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  contract_id   INT UNSIGNED  NOT NULL,
  event         VARCHAR(24)   NOT NULL,
  actor         VARCHAR(100)  NOT NULL,
  ip            VARCHAR(64)   NULL DEFAULT NULL,
  user_agent    VARCHAR(300)  NULL DEFAULT NULL,
  content_hash  CHAR(64)      NULL DEFAULT NULL,
  detail        VARCHAR(500)  NULL DEFAULT NULL,
  created_at    BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_esign_events_contract (contract_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS esign_documents (
  contract_id   INT UNSIGNED  NOT NULL,
  pdf           MEDIUMBLOB    NOT NULL,
  pdf_hash      CHAR(64)      NOT NULL,
  content_hash  CHAR(64)      NOT NULL,
  created_at    BIGINT        NOT NULL,
  PRIMARY KEY (contract_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
