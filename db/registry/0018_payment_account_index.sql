-- Elephant Source — índice global de cuentas de cobro (Stripe Connect) por empresa (aditiva).
--   tenant_payment_accounts: qué empresa es dueña de cada cuenta Stripe vinculada (acct_…). Existe porque la vinculación
--     de cada empresa vive en SU base de datos y una restricción de unicidad allí no impide que dos empresas vinculen
--     la misma cuenta. Aquí la clave primaria es la cuenta: una cuenta pertenece a UNA sola empresa. Además, una
--     empresa tiene como mucho una cuenta por proveedor y modo. Lo escribe solo el plano de control (el Core, que lee
--     el registro con un usuario de solo lectura, solicita la reserva por un canal firmado y lo lee para resolver el
--     webhook de cuentas conectadas de forma inequívoca).
-- Solo crea una tabla nueva y vacía. Repetible (IF NOT EXISTS). Sin claves foráneas.
-- Reversión: 0018_payment_account_index.down.sql (NO ejecutar sin exportar antes: se perdería qué cuenta es de quién).

CREATE TABLE IF NOT EXISTS tenant_payment_accounts (
  account_id VARCHAR(64) NOT NULL,
  tenant_id  VARCHAR(63) NOT NULL,
  provider   VARCHAR(16) NOT NULL DEFAULT 'stripe',
  mode       VARCHAR(8)  NOT NULL,
  claimed_at BIGINT      NOT NULL,
  PRIMARY KEY (account_id),
  UNIQUE KEY uq_tenant_payment_accounts_tenant (tenant_id, provider, mode),
  CONSTRAINT chk_tenant_payment_accounts_mode CHECK (mode IN ('test','live'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- El marcador de versión (registry_meta) lo fija el aplicador tras verificar las tablas: sin UPDATE aquí.
