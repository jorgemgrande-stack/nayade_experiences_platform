-- Auditoría de la migración de credenciales heredadas (scripts/legacy-credentials.ts): una fila por
-- campo cifrado/restaurado, SIN valores. Aditiva: solo crea una tabla nueva. Antes la creaba el propio
-- script al ejecutar (fuera de cualquier carril); ahora debe existir antes de cifrar.
CREATE TABLE IF NOT EXISTS legacy_credential_audit (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  at          BIGINT       NOT NULL,
  actor       VARCHAR(100) NOT NULL,
  table_name  VARCHAR(40)  NOT NULL,
  setting_key VARCHAR(100) NOT NULL,
  action      VARCHAR(20)  NOT NULL,
  key_id      VARCHAR(60)  NULL,
  code        VARCHAR(40)  NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
