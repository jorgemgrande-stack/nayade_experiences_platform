-- Big Elephant — Finanzas corporativas, fase 3: gestoría e impuestos (aditiva, base del CRM).
--
-- Obligaciones fiscales y laborales de IRON ELEPHANT CONSULTING, S.L.: el sistema calcula borradores trazables, lleva
-- el calendario y registra lo que el operador declara haber presentado o pagado. NUNCA presenta nada ante la AEAT ni
-- la Seguridad Social. Importes en céntimos enteros, tipos en puntos básicos y fechas DATE (zona Europe/Madrid).
--
-- `fin_tax_settings`: configuración fiscal (una fila, la crea el administrador al guardarla por primera vez; sin
--   siembra: nada se presupone) y `fin_tax_settings_log` (cada versión guardada, solo inserción).
-- `fin_tax_obligations`: una fila por modelo y periodo (`obligation:<modelo>:<año>:<periodo>`, única): vencimiento real,
--   estado, resultado, borrador en JSON con su huella sha256, marca de datos cambiados después de revisar o presentar,
--   presentación (fecha, justificante), pago y sus asientos, congelación del trimestre y último aviso enviado.
-- `fin_tax_obligation_log`: bitácora de cada obligación (solo inserción).
-- `fin_payrolls`: nóminas mensuales por alias del empleado (sin datos personales), con su asiento y su pago.
-- `fin_tax_deferrals` y `fin_tax_deferral_installments`: aplazamientos y fraccionamientos con sus cuotas.
-- `fin_tax_dossiers` y `fin_tax_dossier_log`: requerimientos, comprobaciones, inspecciones y recursos, con bitácora.
-- `fin_tax_corporate_adjustments`: ajustes del Impuesto sobre Sociedades (extracontables, bases negativas pendientes,
--   deducciones y retenciones manuales); se anulan, no se borran.
-- Los justificantes se guardan en `fin_documents` (0035) con propietario `tax_obligation`, `tax_dossier` o `payroll`.
-- Sin estas tablas el libro (0033), las operaciones (0035) y Stripe (0036) funcionan igual: la gestoría no se monta.
--
-- irreversible: son registros fiscales y justificantes que se conservan mientras no prescriban (cuatro años, art. 66 LGT, y seis por el art. 30 del Código de Comercio); el código anterior ignora estas tablas, así que volver atrás no exige quitarlas.

CREATE TABLE fin_tax_settings (
  id TINYINT UNSIGNED NOT NULL,
  legal_name VARCHAR(200) NULL,
  tax_id VARCHAR(20) NULL,
  fiscal_year_start_month TINYINT UNSIGNED NOT NULL DEFAULT 1,
  vat_regime VARCHAR(10) NOT NULL DEFAULT 'general',
  vat_period VARCHAR(10) NOT NULL DEFAULT 'quarterly',
  redeme TINYINT(1) NOT NULL DEFAULT 0,
  sii TINYINT(1) NOT NULL DEFAULT 0,
  vat390_exempt TINYINT(1) NOT NULL DEFAULT 0,
  opening_vat_compensation_cents BIGINT NULL,
  corporate_tax_rate_bp INT NOT NULL DEFAULT 2500,
  new_entity_first_profit_year SMALLINT UNSIGNED NULL,
  has_employees TINYINT(1) NOT NULL DEFAULT 0,
  has_professional_withholdings TINYINT(1) NOT NULL DEFAULT 0,
  has_rent_withholdings TINYINT(1) NOT NULL DEFAULT 0,
  intra_eu_operations TINYINT(1) NOT NULL DEFAULT 0,
  operations_347 TINYINT(1) NOT NULL DEFAULT 1,
  installment_payments_method VARCHAR(8) NOT NULL DEFAULT 'art40_2',
  stripe_vat_id VARCHAR(20) NULL,
  extra_holidays_json TEXT NULL,
  gestoria_email VARCHAR(200) NULL,
  notes TEXT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  updated_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_fin_tax_settings_single CHECK (id = 1),
  CONSTRAINT ck_fin_tax_settings_month CHECK (fiscal_year_start_month BETWEEN 1 AND 12),
  CONSTRAINT ck_fin_tax_settings_rate CHECK (corporate_tax_rate_bp BETWEEN 0 AND 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_settings_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  request_id VARCHAR(100) NULL,
  before_json TEXT NULL,
  after_json TEXT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_settings_log_at (at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_obligations (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  obligation_key VARCHAR(60) NOT NULL,
  model VARCHAR(4) NOT NULL,
  year SMALLINT UNSIGNED NOT NULL,
  period VARCHAR(6) NOT NULL,
  period_from DATE NOT NULL,
  period_to DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pendiente',
  amount_cents BIGINT NULL,
  outcome VARCHAR(16) NULL,
  draft_json MEDIUMTEXT NULL,
  draft_hash CHAR(64) NULL,
  draft_at BIGINT NULL,
  stale TINYINT(1) NOT NULL DEFAULT 0,
  stale_json TEXT NULL,
  reviewed_at BIGINT NULL,
  reviewed_by VARCHAR(100) NULL,
  presented_at BIGINT NULL,
  presented_by VARCHAR(100) NULL,
  presented_on DATE NULL,
  presented_amount_cents BIGINT NULL,
  receipt_ref VARCHAR(100) NULL,
  receipt_document_id BIGINT UNSIGNED NULL,
  paid_at BIGINT NULL,
  paid_by VARCHAR(100) NULL,
  paid_on DATE NULL,
  paid_amount_cents BIGINT NULL,
  payment_entry_id BIGINT UNSIGNED NULL,
  settlement_entry_id BIGINT UNSIGNED NULL,
  frozen_at BIGINT NULL,
  frozen_by VARCHAR(100) NULL,
  last_reminder_days INT NULL,
  notes TEXT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_tax_obligation_key (obligation_key),
  KEY ix_fin_tax_obligation_year (year, model, period),
  KEY ix_fin_tax_obligation_due (status, due_date),
  CONSTRAINT fk_fin_tax_obligation_receipt FOREIGN KEY (receipt_document_id) REFERENCES fin_documents (id),
  CONSTRAINT fk_fin_tax_obligation_payment FOREIGN KEY (payment_entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_tax_obligation_settlement FOREIGN KEY (settlement_entry_id) REFERENCES fin_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_obligation_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  obligation_id BIGINT UNSIGNED NOT NULL,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  request_id VARCHAR(100) NULL,
  action VARCHAR(30) NOT NULL,
  from_status VARCHAR(16) NULL,
  to_status VARCHAR(16) NULL,
  note VARCHAR(500) NULL,
  detail_json TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_obligation_log (obligation_id, id),
  CONSTRAINT fk_fin_tax_obligation_log FOREIGN KEY (obligation_id) REFERENCES fin_tax_obligations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_payrolls (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  period CHAR(7) NOT NULL,
  employee_alias VARCHAR(60) NOT NULL,
  gross_cents BIGINT NOT NULL,
  irpf_cents BIGINT NOT NULL,
  ss_employee_cents BIGINT NOT NULL,
  ss_company_cents BIGINT NOT NULL,
  net_cents BIGINT NOT NULL,
  pay_date DATE NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'draft',
  entry_id BIGINT UNSIGNED NULL,
  payment_entry_id BIGINT UNSIGNED NULL,
  paid_on DATE NULL,
  bank_account_id BIGINT UNSIGNED NULL,
  notes VARCHAR(500) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_payroll (period, employee_alias),
  KEY ix_fin_payroll_status (status, period),
  CONSTRAINT fk_fin_payroll_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_payroll_payment FOREIGN KEY (payment_entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_payroll_bank FOREIGN KEY (bank_account_id) REFERENCES fin_bank_accounts (id),
  CONSTRAINT ck_fin_payroll_amounts CHECK (gross_cents >= 0 AND irpf_cents >= 0 AND ss_employee_cents >= 0 AND ss_company_cents >= 0 AND net_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_deferrals (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  obligation_id BIGINT UNSIGNED NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'solicitado',
  requested_on DATE NOT NULL,
  resolution_on DATE NULL,
  reference VARCHAR(60) NULL,
  principal_cents BIGINT NOT NULL,
  interest_cents BIGINT NOT NULL DEFAULT 0,
  notes VARCHAR(500) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_deferral_obligation (obligation_id),
  CONSTRAINT fk_fin_tax_deferral_obligation FOREIGN KEY (obligation_id) REFERENCES fin_tax_obligations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_deferral_installments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  deferral_id BIGINT UNSIGNED NOT NULL,
  number SMALLINT UNSIGNED NOT NULL,
  due_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL,
  interest_cents BIGINT NOT NULL DEFAULT 0,
  status VARCHAR(10) NOT NULL DEFAULT 'pendiente',
  paid_on DATE NULL,
  entry_id BIGINT UNSIGNED NULL,
  paid_by VARCHAR(100) NULL,
  paid_at BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_tax_deferral_installment (deferral_id, number),
  CONSTRAINT fk_fin_tax_installment_deferral FOREIGN KEY (deferral_id) REFERENCES fin_tax_deferrals (id),
  CONSTRAINT fk_fin_tax_installment_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_dossiers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind VARCHAR(16) NOT NULL,
  agency VARCHAR(120) NOT NULL,
  reference VARCHAR(80) NULL,
  subject VARCHAR(300) NOT NULL,
  notified_on DATE NULL,
  response_due_on DATE NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'abierto',
  obligation_id BIGINT UNSIGNED NULL,
  notes TEXT NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  closed_at BIGINT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_dossier_status (status, response_due_on),
  CONSTRAINT fk_fin_tax_dossier_obligation FOREIGN KEY (obligation_id) REFERENCES fin_tax_obligations (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_dossier_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  dossier_id BIGINT UNSIGNED NOT NULL,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  request_id VARCHAR(100) NULL,
  action VARCHAR(30) NOT NULL,
  note VARCHAR(2000) NULL,
  detail_json TEXT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_dossier_log (dossier_id, id),
  CONSTRAINT fk_fin_tax_dossier_log FOREIGN KEY (dossier_id) REFERENCES fin_tax_dossiers (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_corporate_adjustments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  kind VARCHAR(16) NOT NULL,
  description VARCHAR(300) NOT NULL,
  amount_cents BIGINT NOT NULL,
  origin_year SMALLINT UNSIGNED NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'active',
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  voided_by VARCHAR(100) NULL,
  voided_at BIGINT NULL,
  void_reason VARCHAR(300) NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_adjustment_year (year, status),
  CONSTRAINT ck_fin_tax_adjustment_amount CHECK (amount_cents > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
