-- Elephant Source — segundo factor (TOTP) de los operadores del plano de control (aditiva).
--   cp_operators: secreto TOTP CIFRADO con el llavero del registro (AES-256-GCM, REGISTRY_KEYS; datos
--     autenticados por operador), cuándo se activó y el último paso aceptado (impide reutilizar un código).
--     Mientras `mfa_enabled_at` es NULL, el secreto es un alta sin confirmar.
--   cp_operator_sessions.mfa_state: `none` (sesión normal), `pending` (contraseña correcta, falta el código:
--     no sirve para nada salvo verificarlo) o `setup` (su rol exige MFA y aún no lo tiene: solo puede darlo
--     de alta).
--   cp_operator_recovery_codes: códigos de recuperación de un solo uso (solo su SHA-256).
--   Sin secretos en claro.
-- El código funciona sin esta migración (sin MFA, como hasta ahora); al aplicarla se habilita.
-- Reversión: DROP TABLE cp_operator_recovery_codes; ALTER TABLE cp_operator_sessions DROP COLUMN mfa_state;
--   ALTER TABLE cp_operators DROP COLUMN mfa_last_step, DROP COLUMN mfa_enabled_at, DROP COLUMN mfa_key_id,
--   DROP COLUMN mfa_secret_cipher; UPDATE registry_meta SET v = '0011' WHERE k = 'schema_version';

ALTER TABLE cp_operators
  ADD COLUMN mfa_secret_cipher VARCHAR(255) NULL,
  ADD COLUMN mfa_key_id        VARCHAR(32)  NULL,
  ADD COLUMN mfa_enabled_at    BIGINT       NULL,
  ADD COLUMN mfa_last_step     BIGINT       NULL;

ALTER TABLE cp_operator_sessions
  ADD COLUMN mfa_state ENUM('none','pending','setup') NOT NULL DEFAULT 'none';

CREATE TABLE IF NOT EXISTS cp_operator_recovery_codes (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  operator_id INT      NOT NULL,
  code_hash   CHAR(64) NOT NULL,
  created_at  BIGINT   NOT NULL,
  used_at     BIGINT   NULL,
  UNIQUE KEY uq_recovery_code (code_hash),
  KEY idx_recovery_operator (operator_id, used_at),
  CONSTRAINT fk_recovery_operator FOREIGN KEY (operator_id) REFERENCES cp_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0012' WHERE k = 'schema_version';
