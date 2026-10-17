-- ============================================================================
-- Registro de tenants — esquema v1.7.0: operadores humanos del plano de control
-- Usuarios con contraseña (Argon2id), sesiones persistentes (solo el hash del token),
-- enlaces de restablecimiento de un solo uso (solo el hash) y auditoría de accesos.
-- Los tokens de servicio (máquina a máquina) no cambian: siguen en CP_TOKENS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS cp_operators (
  id                  INT AUTO_INCREMENT PRIMARY KEY,
  username            VARCHAR(64)  NOT NULL,
  email               VARCHAR(254) NULL,
  display_name        VARCHAR(120) NOT NULL,
  role                ENUM('superadmin','admin','sales','support','readonly') NOT NULL,
  status              ENUM('active','disabled') NOT NULL DEFAULT 'active',
  password_hash       VARCHAR(255) NOT NULL,
  failed_attempts     INT          NOT NULL DEFAULT 0,
  locked_until        BIGINT       NULL,
  password_changed_at BIGINT       NOT NULL,
  last_login_at       BIGINT       NULL,
  created_at          BIGINT       NOT NULL,
  updated_at          BIGINT       NOT NULL,
  created_by          VARCHAR(100) NOT NULL,
  UNIQUE KEY uq_operator_username (username),
  UNIQUE KEY uq_operator_email (email),
  KEY idx_operator_role (role, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cp_operator_sessions (
  id             CHAR(64)     NOT NULL PRIMARY KEY,
  operator_id    INT          NOT NULL,
  csrf_token     VARCHAR(64)  NOT NULL,
  created_at     BIGINT       NOT NULL,
  last_seen_at   BIGINT       NOT NULL,
  expires_at     BIGINT       NOT NULL,
  revoked_at     BIGINT       NULL,
  revoked_reason VARCHAR(40)  NULL,
  ip             VARCHAR(45)  NULL,
  user_agent     VARCHAR(255) NULL,
  KEY idx_session_operator (operator_id, revoked_at, expires_at),
  CONSTRAINT fk_session_operator FOREIGN KEY (operator_id) REFERENCES cp_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cp_password_resets (
  token_hash  CHAR(64)     NOT NULL PRIMARY KEY,
  operator_id INT          NOT NULL,
  created_at  BIGINT       NOT NULL,
  expires_at  BIGINT       NOT NULL,
  used_at     BIGINT       NULL,
  KEY idx_reset_operator (operator_id, used_at),
  CONSTRAINT fk_reset_operator FOREIGN KEY (operator_id) REFERENCES cp_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS cp_operator_events (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  at          BIGINT       NOT NULL,
  operator_id INT          NULL,
  username    VARCHAR(64)  NULL,
  actor       VARCHAR(100) NOT NULL,
  kind        VARCHAR(40)  NOT NULL,
  ip          VARCHAR(45)  NULL,
  user_agent  VARCHAR(255) NULL,
  details     JSON         NULL,
  KEY idx_operator_event (operator_id, at),
  KEY idx_operator_event_kind (kind, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0007' WHERE k = 'schema_version';
