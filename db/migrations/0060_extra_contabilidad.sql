-- Big Elephant — Extra · Contabilidad general (server/accountingGeneral, capacidad accounting-general): contabilidad de
-- doble partida de cada empresa con asientos automáticos desde lo que ya registra el Core (facturas, abonos, tickets,
-- cobros, gastos, pagos y cierres de caja) y asientos manuales. Aditiva, BD de cada empresa. Solo crea tablas nuevas
-- (prefijo acc_); no modifica ninguna existente ni toca las tablas fin_* de las finanzas corporativas (CRM). Nunca se
-- ejecuta al arrancar. El plan de cuentas (PGC de pymes) lo siembra la aplicación la primera vez que se usa.
--
-- `acc_settings`: una fila (id = 1) con la fecha de inicio de la contabilidad (los documentos anteriores no se
--   contabilizan solos: los saldos de apertura van en un asiento manual), la fecha de bloqueo (nada se contabiliza ni
--   se revierte en o antes de ella), las cuentas de cada asiento automático (JSON) y el resultado de la última
--   generación.
-- `acc_accounts`: plan de cuentas (código PGC de 3 a 12 dígitos). Las subcuentas heredan el tipo de su cuenta.
-- `acc_category_accounts`: cuenta del grupo 6 de cada categoría de gasto del Core (sin fila, la de por defecto).
-- `acc_sequences`: último número de asiento de cada ejercicio (correlativo, sin huecos: se asigna en la transacción).
-- `acc_entries` / `acc_entry_lines`: asientos contabilizados y sus líneas (céntimos; debe XOR haber > 0). Inmutables:
--   se corrigen con un asiento de reversión enlazado. `source_key` única: un asiento por versión de cada documento.
-- `acc_sources`: estado contable de cada documento del Core (`inv:<id>`, `tpv:<id>`, `cobro:<id>`, `gasto:<id>`,
--   `pago:<id>`, `cierre:<id>`, `cajamov:<id>`): asiento vigente y huella de su contenido. Clave natural: generar
--   otra vez nunca duplica; si el documento cambia, se revierte el asiento y se contabiliza la versión nueva.

CREATE TABLE IF NOT EXISTS acc_settings (
  id              TINYINT UNSIGNED NOT NULL,
  start_date      DATE             NOT NULL,
  locked_until    DATE             NULL DEFAULT NULL,
  account_map     JSON             NULL,
  last_sync_at    DATETIME(3)      NULL DEFAULT NULL,
  last_sync       JSON             NULL,
  updated_by      INT              NULL DEFAULT NULL,
  created_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at      DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_acc_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acc_accounts (
  code         VARCHAR(12)   NOT NULL,
  name         VARCHAR(160)  NOT NULL,
  type         VARCHAR(10)   NOT NULL,
  parent_code  VARCHAR(12)   NULL DEFAULT NULL,
  is_postable  TINYINT(1)    NOT NULL DEFAULT 1,
  active       TINYINT(1)    NOT NULL DEFAULT 1,
  is_seed      TINYINT(1)    NOT NULL DEFAULT 0,
  created_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (code),
  KEY idx_acc_accounts_parent (parent_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acc_category_accounts (
  category_id   INT           NOT NULL,
  account_code  VARCHAR(12)   NOT NULL,
  updated_by    INT           NULL DEFAULT NULL,
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acc_sequences (
  year         SMALLINT UNSIGNED NOT NULL,
  last_number  INT UNSIGNED      NOT NULL DEFAULT 0,
  PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acc_entries (
  id                    INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  year                  SMALLINT UNSIGNED NOT NULL,
  number                INT UNSIGNED      NOT NULL,
  entry_date            DATE              NOT NULL,
  journal               VARCHAR(3)        NOT NULL,
  description           VARCHAR(500)      NOT NULL,
  origin                VARCHAR(16)       NOT NULL,
  source_key            VARCHAR(96)       NULL DEFAULT NULL,
  total_cents           BIGINT UNSIGNED   NOT NULL,
  reverses_entry_id     INT UNSIGNED      NULL DEFAULT NULL,
  reversed_by_entry_id  INT UNSIGNED      NULL DEFAULT NULL,
  created_by            INT               NULL DEFAULT NULL,
  created_at            DATETIME(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_acc_entries_number (year, number),
  UNIQUE KEY uq_acc_entries_source (source_key),
  KEY idx_acc_entries_date (entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acc_entry_lines (
  entry_id        INT UNSIGNED    NOT NULL,
  line_no         SMALLINT UNSIGNED NOT NULL,
  account_code    VARCHAR(12)     NOT NULL,
  debit_cents     BIGINT UNSIGNED NOT NULL DEFAULT 0,
  credit_cents    BIGINT UNSIGNED NOT NULL DEFAULT 0,
  description     VARCHAR(300)    NULL DEFAULT NULL,
  tax_rate_bp     INT UNSIGNED    NULL DEFAULT NULL,
  tax_base_cents  BIGINT          NULL DEFAULT NULL,
  PRIMARY KEY (entry_id, line_no),
  KEY idx_acc_entry_lines_account (account_code),
  CONSTRAINT chk_acc_entry_lines_side CHECK ((debit_cents > 0 AND credit_cents = 0) OR (debit_cents = 0 AND credit_cents > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS acc_sources (
  source_key  VARCHAR(80)   NOT NULL,
  entry_id    INT UNSIGNED  NULL DEFAULT NULL,
  hash        CHAR(64)      NULL DEFAULT NULL,
  version     INT UNSIGNED  NOT NULL DEFAULT 0,
  updated_at  DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (source_key),
  KEY idx_acc_sources_entry (entry_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
