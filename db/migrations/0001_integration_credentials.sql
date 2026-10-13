-- Credenciales de integraciones por tenant (cifradas en la aplicación; ver server/_core/credentials).
-- Aditiva y reversible: solo crea una tabla nueva.
CREATE TABLE IF NOT EXISTS integration_credentials (
  provider   VARCHAR(32)  NOT NULL,
  field      VARCHAR(64)  NOT NULL,
  is_secret  TINYINT(1)   NOT NULL DEFAULT 0,
  value      TEXT         NOT NULL,
  key_id     VARCHAR(32)  NULL,
  updated_by VARCHAR(100) NULL,
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider, field)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
