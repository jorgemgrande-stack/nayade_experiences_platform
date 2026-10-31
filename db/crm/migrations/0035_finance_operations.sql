-- Big Elephant — Finanzas corporativas, fase 1B: operaciones (aditiva, base del CRM).
--
-- Gastos, proveedores, bancos y caja de IRON ELEPHANT CONSULTING, S.L., nunca de los tenants. Importes en céntimos
-- enteros (con signo donde se indica), tipos en puntos básicos y fechas DATE (zona Europe/Madrid).
--
-- `fin_cost_centers`: centros de coste (se siembra «General»).
-- `fin_expense_categories`: categorías de gasto con su cuenta del grupo 6 y su IVA por defecto (sembradas).
-- `fin_suppliers`: registro único de proveedores (gastos, compras y liquidaciones); NIF único.
-- `fin_expenses`: facturas recibidas y gastos (borrador, registrado con su asiento, anulado). Lo pagado se guarda
--   junto al gasto; el pendiente es total menos retención menos pagos vigentes. Una factura por proveedor y número
--   mientras no esté anulada (columna generada). Los borradores de los gastos recurrentes llevan `source_key` única.
-- `fin_expense_payments`: pagos de gastos con su asiento (vigente o revertido) y, si lo hay, su movimiento bancario.
-- `fin_documents`: adjuntos (PDF, PNG, JPEG, XML, CSV; hasta 10 MB) guardados en la propia BD; se archivan, no se borran.
-- `fin_recurring_expenses`: plantillas de gastos recurrentes (mensual, trimestral o anual).
-- `fin_bank_accounts`: cuentas bancarias, cada una con su subcuenta 572000NN.
-- `fin_bank_imports`: extractos importados (Norma 43, CaixaBank o CSV); un fichero una sola vez por cuenta (sha256).
-- `fin_bank_movements`: movimientos bancarios con signo; clave de duplicado única por cuenta; conciliación.
-- `fin_cash_accounts` y `fin_cash_movements`: cajas (subcuenta 570000NN) y sus movimientos contabilizados.
-- Sin estas tablas el libro de la fase 1A funciona igual: las operaciones no se montan.
--
-- irreversible: son registros contables y justificantes que se conservan seis años por obligación legal (art. 30 del Código de Comercio); el código anterior ignora estas tablas, así que volver atrás no exige quitarlas.

CREATE TABLE fin_cost_centers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(20) NOT NULL,
  name VARCHAR(120) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_cost_center_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_expense_categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  account_code VARCHAR(12) NOT NULL,
  default_tax_rate_bp INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_category_name (name),
  CONSTRAINT fk_fin_category_account FOREIGN KEY (account_code) REFERENCES fin_accounts (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_suppliers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  legal_name VARCHAR(200) NULL,
  tax_id VARCHAR(20) NULL,
  country CHAR(2) NOT NULL DEFAULT 'ES',
  address VARCHAR(300) NULL,
  email VARCHAR(160) NULL,
  phone VARCHAR(40) NULL,
  iban VARCHAR(34) NULL,
  payment_terms_days SMALLINT UNSIGNED NULL,
  default_category_id BIGINT UNSIGNED NULL,
  default_cost_center_id BIGINT UNSIGNED NULL,
  account_code VARCHAR(12) NOT NULL DEFAULT '410',
  notes VARCHAR(1000) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_supplier_tax_id (tax_id),
  KEY ix_fin_supplier_name (active, name),
  CONSTRAINT fk_fin_supplier_category FOREIGN KEY (default_category_id) REFERENCES fin_expense_categories (id),
  CONSTRAINT fk_fin_supplier_center FOREIGN KEY (default_cost_center_id) REFERENCES fin_cost_centers (id),
  CONSTRAINT fk_fin_supplier_account FOREIGN KEY (account_code) REFERENCES fin_accounts (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id BIGINT UNSIGNED NULL,
  category_id BIGINT UNSIGNED NULL,
  cost_center_id BIGINT UNSIGNED NULL,
  invoice_number VARCHAR(60) NULL,
  invoice_date DATE NOT NULL,
  accrual_date DATE NULL,
  due_date DATE NULL,
  description VARCHAR(500) NOT NULL,
  base_cents BIGINT NOT NULL,
  tax_rate_bp INT NOT NULL,
  tax_cents BIGINT NOT NULL,
  deductible_bp INT NOT NULL DEFAULT 10000,
  withholding_rate_bp INT NOT NULL DEFAULT 0,
  withholding_cents BIGINT NOT NULL DEFAULT 0,
  total_cents BIGINT NOT NULL,
  paid_cents BIGINT NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  kind VARCHAR(16) NOT NULL,
  rectifies_expense_id BIGINT UNSIGNED NULL,
  status VARCHAR(12) NOT NULL,
  entry_id BIGINT UNSIGNED NULL,
  payment_status VARCHAR(8) NOT NULL DEFAULT 'pending',
  source_key VARCHAR(160) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  registered_by VARCHAR(100) NULL,
  registered_at BIGINT NULL,
  voided_by VARCHAR(100) NULL,
  voided_at BIGINT NULL,
  void_reason VARCHAR(300) NULL,
  live_invoice_number VARCHAR(60) GENERATED ALWAYS AS (IF(status <> 'void', invoice_number, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_expense_number (supplier_id, live_invoice_number),
  UNIQUE KEY uq_fin_expense_source (source_key),
  KEY ix_fin_expense_date (status, invoice_date),
  KEY ix_fin_expense_due (payment_status, due_date),
  CONSTRAINT fk_fin_expense_supplier FOREIGN KEY (supplier_id) REFERENCES fin_suppliers (id),
  CONSTRAINT fk_fin_expense_category FOREIGN KEY (category_id) REFERENCES fin_expense_categories (id),
  CONSTRAINT fk_fin_expense_center FOREIGN KEY (cost_center_id) REFERENCES fin_cost_centers (id),
  CONSTRAINT fk_fin_expense_rectifies FOREIGN KEY (rectifies_expense_id) REFERENCES fin_expenses (id),
  CONSTRAINT fk_fin_expense_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_bank_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  iban VARCHAR(34) NULL,
  bank_name VARCHAR(120) NULL,
  account_code VARCHAR(12) NOT NULL,
  opening_date DATE NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_bank_account_code (account_code),
  UNIQUE KEY uq_fin_bank_account_iban (iban),
  CONSTRAINT fk_fin_bank_account_code FOREIGN KEY (account_code) REFERENCES fin_accounts (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_cash_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(120) NOT NULL,
  account_code VARCHAR(12) NOT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_cash_account_code (account_code),
  CONSTRAINT fk_fin_cash_account_code FOREIGN KEY (account_code) REFERENCES fin_accounts (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_bank_imports (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bank_account_id BIGINT UNSIGNED NOT NULL,
  format VARCHAR(12) NOT NULL,
  filename VARCHAR(200) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  row_count INT UNSIGNED NOT NULL DEFAULT 0,
  inserted_count INT UNSIGNED NOT NULL DEFAULT 0,
  duplicate_count INT UNSIGNED NOT NULL DEFAULT 0,
  imported_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_bank_import_file (bank_account_id, sha256),
  CONSTRAINT fk_fin_bank_import_account FOREIGN KEY (bank_account_id) REFERENCES fin_bank_accounts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_bank_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  bank_account_id BIGINT UNSIGNED NOT NULL,
  import_id BIGINT UNSIGNED NULL,
  booking_date DATE NOT NULL,
  value_date DATE NULL,
  amount_cents BIGINT NOT NULL,
  description VARCHAR(500) NOT NULL,
  reference VARCHAR(140) NULL,
  counterparty VARCHAR(160) NULL,
  balance_cents BIGINT NULL,
  duplicate_key CHAR(64) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'pending',
  match_type VARCHAR(16) NULL,
  match_id BIGINT UNSIGNED NULL,
  entry_id BIGINT UNSIGNED NULL,
  match_count INT UNSIGNED NOT NULL DEFAULT 0,
  matched_by VARCHAR(100) NULL,
  matched_at BIGINT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_bank_movement_dup (bank_account_id, duplicate_key),
  KEY ix_fin_bank_movement_list (bank_account_id, status, booking_date),
  KEY ix_fin_bank_movement_date (status, booking_date),
  CONSTRAINT fk_fin_bank_movement_account FOREIGN KEY (bank_account_id) REFERENCES fin_bank_accounts (id),
  CONSTRAINT fk_fin_bank_movement_import FOREIGN KEY (import_id) REFERENCES fin_bank_imports (id),
  CONSTRAINT fk_fin_bank_movement_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT ck_fin_bank_movement_amount CHECK (amount_cents <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_expense_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  expense_id BIGINT UNSIGNED NOT NULL,
  paid_on DATE NOT NULL,
  amount_cents BIGINT NOT NULL,
  method VARCHAR(16) NOT NULL,
  bank_account_id BIGINT UNSIGNED NULL,
  cash_account_id BIGINT UNSIGNED NULL,
  reference VARCHAR(140) NULL,
  bank_movement_id BIGINT UNSIGNED NULL,
  entry_id BIGINT UNSIGNED NULL,
  status VARCHAR(10) NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  reversed_by VARCHAR(100) NULL,
  reversed_at BIGINT NULL,
  reverse_reason VARCHAR(300) NULL,
  PRIMARY KEY (id),
  KEY ix_fin_payment_expense (expense_id, status),
  KEY ix_fin_payment_movement (bank_movement_id),
  KEY ix_fin_payment_open (status, bank_account_id, paid_on),
  CONSTRAINT fk_fin_payment_expense FOREIGN KEY (expense_id) REFERENCES fin_expenses (id),
  CONSTRAINT fk_fin_payment_bank FOREIGN KEY (bank_account_id) REFERENCES fin_bank_accounts (id),
  CONSTRAINT fk_fin_payment_cash FOREIGN KEY (cash_account_id) REFERENCES fin_cash_accounts (id),
  CONSTRAINT fk_fin_payment_movement FOREIGN KEY (bank_movement_id) REFERENCES fin_bank_movements (id),
  CONSTRAINT fk_fin_payment_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT ck_fin_payment_amount CHECK (amount_cents <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_documents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  owner_type VARCHAR(16) NOT NULL,
  owner_id BIGINT UNSIGNED NOT NULL,
  filename VARCHAR(200) NOT NULL,
  mime VARCHAR(60) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  sha256 CHAR(64) NOT NULL,
  content MEDIUMBLOB NOT NULL,
  uploaded_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  archived_at BIGINT NULL,
  archived_by VARCHAR(100) NULL,
  PRIMARY KEY (id),
  KEY ix_fin_document_owner (owner_type, owner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_recurring_expenses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  supplier_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  cost_center_id BIGINT UNSIGNED NULL,
  description VARCHAR(400) NOT NULL,
  base_cents BIGINT NOT NULL,
  tax_rate_bp INT NOT NULL,
  deductible_bp INT NOT NULL DEFAULT 10000,
  withholding_rate_bp INT NOT NULL DEFAULT 0,
  frequency VARCHAR(10) NOT NULL,
  day_of_month TINYINT UNSIGNED NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  next_date DATE NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_recurring_active (active, next_date),
  CONSTRAINT fk_fin_recurring_supplier FOREIGN KEY (supplier_id) REFERENCES fin_suppliers (id),
  CONSTRAINT fk_fin_recurring_category FOREIGN KEY (category_id) REFERENCES fin_expense_categories (id),
  CONSTRAINT fk_fin_recurring_center FOREIGN KEY (cost_center_id) REFERENCES fin_cost_centers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_cash_movements (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cash_account_id BIGINT UNSIGNED NOT NULL,
  moved_on DATE NOT NULL,
  amount_cents BIGINT NOT NULL,
  description VARCHAR(300) NOT NULL,
  counterpart_account_code VARCHAR(12) NOT NULL,
  entry_id BIGINT UNSIGNED NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'posted',
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_cash_movement_account (cash_account_id, moved_on),
  CONSTRAINT fk_fin_cash_movement_account FOREIGN KEY (cash_account_id) REFERENCES fin_cash_accounts (id),
  CONSTRAINT fk_fin_cash_movement_counterpart FOREIGN KEY (counterpart_account_code) REFERENCES fin_accounts (code),
  CONSTRAINT fk_fin_cash_movement_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT ck_fin_cash_movement_amount CHECK (amount_cents <> 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO fin_cost_centers (code, name, active, created_at) VALUES
  ('GENERAL', 'General', 1, 0);

INSERT INTO fin_expense_categories (name, account_code, default_tax_rate_bp, active, created_at) VALUES
  ('Hosting e infraestructura en la nube', '629', 2100, 1, 0),
  ('Software y licencias', '629', 2100, 1, 0),
  ('Dominios y certificados', '629', 2100, 1, 0),
  ('Asesoría fiscal, contable y laboral', '623', 2100, 1, 0),
  ('Servicios jurídicos y notaría', '623', 2100, 1, 0),
  ('Desarrollo y diseño externos', '623', 2100, 1, 0),
  ('Publicidad y marketing', '627', 2100, 1, 0),
  ('Comisiones bancarias', '626', 0, 1, 0),
  ('Comisiones de pasarelas de pago', '626', 0, 1, 0),
  ('Seguros', '625', 0, 1, 0),
  ('Suministros, telefonía e internet', '628', 2100, 1, 0),
  ('Alquileres y coworking', '621', 2100, 1, 0),
  ('Reparaciones y mantenimiento', '622', 2100, 1, 0),
  ('Transportes y mensajería', '624', 2100, 1, 0),
  ('Viajes y desplazamientos', '629', 1000, 1, 0),
  ('Formación', '629', 2100, 1, 0),
  ('Material de oficina', '629', 2100, 1, 0),
  ('Tributos y tasas', '631', 0, 1, 0),
  ('Intereses de préstamos', '662', 0, 1, 0);
