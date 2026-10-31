-- Big Elephant — Finanzas corporativas, fase 2: Stripe como TPV principal (aditiva, base del CRM).
--
-- Cobros, comisiones, reembolsos, disputas y liquidaciones (payouts) de IRON ELEPHANT CONSULTING, S.L. en Stripe, y su
-- conciliación con las facturas propias y los movimientos bancarios. El origen contable de cada hecho es la transacción
-- de saldo de Stripe importada de los informes del panel (nunca los webhooks ni los eventos comerciales). Importes en
-- céntimos enteros con el signo de Stripe, tipos en puntos básicos y fechas DATE (zona Europe/Madrid).
--
-- `fin_stripe_settings`: configuración (una fila): IVA de las comisiones (exenta o inversión del sujeto pasivo) y su
--   tipo, cuenta bancaria de destino de los payouts y cuenta de las disputas (430 o una de dudoso cobro).
-- `fin_stripe_imports`: ficheros importados (transacciones de saldo o payouts); cada fichero una sola vez por tipo
--   (sha256), con sus recuentos y los avisos de las filas que no se pudieron leer.
-- `fin_stripe_transactions`: transacciones de saldo, una por identificador de Stripe y proveedor (la columna
--   `provider` deja sitio a otras pasarelas). Guarda la fecha del cobro y la de disponibilidad, la factura de Stripe y la
--   propia con la que casa, el payout en el que se liquidó, su asiento (`stripe-txn:<id>`) y la incidencia para revisar.
-- `fin_stripe_payouts`: liquidaciones al banco, una por identificador de Stripe; fecha de llegada, estado, su asiento
--   (`stripe-payout:<id>`), la reversión si falló y el movimiento bancario vinculado (sin asiento nuevo; un movimiento
--   como mucho por payout y un payout por movimiento).
-- Sin estas tablas el libro (0033) y las operaciones (0034) funcionan igual: la parte de Stripe no se monta.
--
-- irreversible: son registros contables y justificantes de cobro que se conservan seis años por obligación legal (art. 30 del Código de Comercio); el código anterior ignora estas tablas, así que volver atrás no exige quitarlas.

CREATE TABLE fin_stripe_settings (
  id TINYINT UNSIGNED NOT NULL,
  fee_vat VARCHAR(16) NOT NULL DEFAULT 'exempt',
  fee_vat_rate_bp INT NOT NULL DEFAULT 2100,
  payout_bank_account_id BIGINT UNSIGNED NULL,
  dispute_account_code VARCHAR(12) NOT NULL DEFAULT '430',
  updated_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT fk_fin_stripe_settings_bank FOREIGN KEY (payout_bank_account_id) REFERENCES fin_bank_accounts (id),
  CONSTRAINT fk_fin_stripe_settings_dispute FOREIGN KEY (dispute_account_code) REFERENCES fin_accounts (code),
  CONSTRAINT ck_fin_stripe_settings_single CHECK (id = 1),
  CONSTRAINT ck_fin_stripe_settings_rate CHECK (fee_vat_rate_bp BETWEEN 0 AND 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_stripe_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind VARCHAR(10) NOT NULL,
  filename VARCHAR(200) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  refreshed_count INT UNSIGNED NOT NULL DEFAULT 0,
  non_eur_count INT UNSIGNED NOT NULL DEFAULT 0,
  error_count INT UNSIGNED NOT NULL DEFAULT 0,
  problems_json TEXT NULL,
  imported_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_stripe_import_file (kind, sha256),
  KEY ix_fin_stripe_import_date (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_stripe_payouts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(16) NOT NULL DEFAULT 'stripe',
  payout_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  import_id BIGINT UNSIGNED NULL,
  origin VARCHAR(10) NOT NULL,
  created_on DATE NULL,
  arrival_on DATE NOT NULL,
  currency CHAR(3) NOT NULL,
  amount_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL,
  description VARCHAR(300) NULL,
  entry_id BIGINT UNSIGNED NULL,
  reversal_entry_id BIGINT UNSIGNED NULL,
  bank_movement_id BIGINT UNSIGNED NULL,
  bank_linked_by VARCHAR(100) NULL,
  bank_linked_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_stripe_payout (provider, payout_id),
  UNIQUE KEY uq_fin_stripe_payout_bank (bank_movement_id),
  KEY ix_fin_stripe_payout_arrival (status, arrival_on),
  CONSTRAINT fk_fin_stripe_payout_import FOREIGN KEY (import_id) REFERENCES fin_stripe_imports (id),
  CONSTRAINT fk_fin_stripe_payout_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_stripe_payout_reversal FOREIGN KEY (reversal_entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_stripe_payout_bank FOREIGN KEY (bank_movement_id) REFERENCES fin_bank_movements (id),
  CONSTRAINT ck_fin_stripe_payout_amount CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_stripe_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider VARCHAR(16) NOT NULL DEFAULT 'stripe',
  balance_transaction_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  import_id BIGINT UNSIGNED NULL,
  type VARCHAR(20) NOT NULL,
  raw_type VARCHAR(40) NOT NULL,
  created_ts BIGINT NULL,
  created_on DATE NOT NULL,
  available_on DATE NULL,
  currency CHAR(3) NOT NULL,
  gross_cents BIGINT NOT NULL,
  fee_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  source_id VARCHAR(80) NULL,
  description VARCHAR(500) NULL,
  customer_id VARCHAR(80) NULL,
  customer_email VARCHAR(160) NULL,
  charge_id VARCHAR(80) NULL,
  payment_intent_id VARCHAR(80) NULL,
  stripe_invoice_id VARCHAR(80) NULL,
  stripe_payout_id VARCHAR(80) NULL,
  own_invoice_id BIGINT UNSIGNED NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  issue VARCHAR(24) NULL,
  issue_detail VARCHAR(300) NULL,
  issue_reviewed_by VARCHAR(100) NULL,
  issue_reviewed_at BIGINT NULL,
  issue_note VARCHAR(300) NULL,
  entry_id BIGINT UNSIGNED NULL,
  posted_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_stripe_txn (provider, balance_transaction_id),
  KEY ix_fin_stripe_txn_status (status, created_on),
  KEY ix_fin_stripe_txn_date (created_on),
  KEY ix_fin_stripe_txn_payout (stripe_payout_id),
  KEY ix_fin_stripe_txn_invoice (own_invoice_id),
  KEY ix_fin_stripe_txn_stripe_invoice (stripe_invoice_id),
  CONSTRAINT fk_fin_stripe_txn_import FOREIGN KEY (import_id) REFERENCES fin_stripe_imports (id),
  CONSTRAINT fk_fin_stripe_txn_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT ck_fin_stripe_txn_net CHECK (net_cents = gross_cents - fee_cents)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
