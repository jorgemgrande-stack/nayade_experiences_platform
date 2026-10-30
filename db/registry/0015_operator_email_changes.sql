-- Elephant Source — cambio verificado del correo de los operadores del plano de control (aditiva).
--   cp_operator_email_changes: un cambio de correo queda PENDIENTE hasta que el correo nuevo lo confirma con un
--     enlace de un solo uso que caduca a las 24 h. Solo se guarda el SHA-256 del enlace (nunca el token).
--     `old_email` es el correo vigente al pedirlo: si cambia antes de confirmar, el enlace deja de valer.
--     `used_at` marca el enlace como usado (o anulado al pedir otro cambio).
-- REPETIBLE (CREATE TABLE IF NOT EXISTS). No toca tablas existentes.
-- El código funciona sin esta migración: el cambio de correo de un operador no está disponible (se rechaza en
-- lugar de aplicarse sin verificar); al aplicarla se habilita.
-- Reversión: DROP TABLE cp_operator_email_changes; UPDATE registry_meta SET v = '0014' WHERE k = 'schema_version';

CREATE TABLE IF NOT EXISTS cp_operator_email_changes (
  token_hash   CHAR(64)     NOT NULL PRIMARY KEY,
  operator_id  INT          NOT NULL,
  old_email    VARCHAR(254) NULL,
  new_email    VARCHAR(254) NOT NULL,
  requested_by VARCHAR(100) NOT NULL,
  created_at   BIGINT       NOT NULL,
  expires_at   BIGINT       NOT NULL,
  used_at      BIGINT       NULL,
  KEY idx_email_change_operator (operator_id, used_at),
  CONSTRAINT fk_email_change_operator FOREIGN KEY (operator_id) REFERENCES cp_operators (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0015' WHERE k = 'schema_version';
