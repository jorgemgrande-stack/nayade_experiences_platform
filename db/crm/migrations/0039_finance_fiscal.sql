-- Big Elephant — Finanzas corporativas: parametrización fiscal previa a los datos reales (aditiva, base del CRM).
--
-- Regla de oro: nada fiscal se presupone. Si una regla no está configurada, el sistema avisa y no contabiliza a ciegas.
-- `fin_tax_settings` gana la validación con la gestoría (`validated_at`, `validated_by`, `validation_note`): sin validar,
--   los borradores se calculan pero no se revisan ni se presentan; cualquier cambio posterior de la configuración la
--   anula en el mismo guardado (queda en `fin_tax_settings_log`). Las filas existentes quedan sin validar (NULL).
-- `fin_expenses` gana el tratamiento del IVA (`vat_treatment`; NULL = interior, el comportamiento anterior) y el tipo de
--   la autoliquidación con inversión del sujeto pasivo (`reverse_charge_rate_bp`). Los gastos ya registrados no cambian.
-- `fin_stripe_fee_vat_rules`: IVA de las comisiones de Stripe por tipo de comisión (o `*`), entidad emisora (país y
--   NIF-IVA) y periodo de vigencia, con el documento que lo justifica. Sin edición: una regla se anula y se crea otra.
-- `fin_tax_corporate_years` y `fin_tax_corporate_year_log`: Impuesto sobre Sociedades por ejercicio (régimen, escala por
--   tramos, reservas de capitalización y nivelación) y su bitácora de solo inserción (antes y después).
-- `fin_tax_corporate_entries`: asiento del Impuesto sobre Sociedades de cada ejercicio (`tax:200:entry:<año>[:<n>]`),
--   con su origen (sistema, manual o gestoría), la diferencia con el borrador y su reversión; uno vivo por ejercicio
--   (columna generada con índice único).
-- `fin_analysis_settings`: dónde van las comisiones de Stripe en el análisis (coste directo, estructura o resultado
--   financiero) y la cuenta de cada naturaleza de comisión bancaria (JSON). Sin fila, los valores por defecto del código.
-- Sin estas tablas y columnas el libro, las operaciones, Stripe, la gestoría y el análisis funcionan como antes; las
-- rutas nuevas no se montan.
--
-- irreversible: son registros fiscales y contables (reglas aplicadas a asientos ya contabilizados, configuración del Impuesto sobre Sociedades y sus asientos) que se conservan con los libros (seis años, art. 30 del Código de Comercio); el código anterior ignora las tablas y columnas nuevas, así que volver atrás no exige quitarlas.

ALTER TABLE fin_tax_settings
  ADD COLUMN validated_at BIGINT NULL,
  ADD COLUMN validated_by VARCHAR(100) NULL,
  ADD COLUMN validation_note VARCHAR(500) NULL;

ALTER TABLE fin_expenses
  ADD COLUMN vat_treatment VARCHAR(24) NULL,
  ADD COLUMN reverse_charge_rate_bp INT NULL;

CREATE TABLE fin_stripe_fee_vat_rules (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  fee_kind VARCHAR(40) NOT NULL,
  issuer_name VARCHAR(120) NOT NULL,
  issuer_country CHAR(2) NOT NULL,
  issuer_vat_id VARCHAR(30) NULL,
  treatment VARCHAR(16) NOT NULL,
  rate_bp INT NULL,
  valid_from DATE NOT NULL,
  valid_to DATE NULL,
  document_ref VARCHAR(120) NULL,
  note VARCHAR(500) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  voided_by VARCHAR(100) NULL,
  voided_at BIGINT NULL,
  void_reason VARCHAR(300) NULL,
  PRIMARY KEY (id),
  KEY ix_fin_stripe_fee_vat_rule_kind (fee_kind, valid_from),
  CONSTRAINT ck_fin_stripe_fee_vat_rule_rate CHECK (rate_bp IS NULL OR rate_bp BETWEEN 0 AND 10000)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_corporate_years (
  year SMALLINT UNSIGNED NOT NULL,
  regime VARCHAR(24) NOT NULL,
  brackets_json TEXT NOT NULL,
  net_turnover_cents BIGINT NULL,
  cap_reserve_equity_increase_cents BIGINT NULL,
  cap_reserve_rate_bp INT NULL,
  cap_reserve_limit_bp INT NULL,
  levelling_reserve_cents BIGINT NULL,
  notes TEXT NULL,
  configured_by VARCHAR(100) NOT NULL,
  configured_at BIGINT NOT NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_corporate_year_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  request_id VARCHAR(100) NULL,
  before_json TEXT NULL,
  after_json TEXT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_fin_tax_corporate_year_log (year, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_tax_corporate_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  seq INT UNSIGNED NOT NULL,
  source_key VARCHAR(160) NOT NULL,
  entry_id BIGINT UNSIGNED NOT NULL,
  origin VARCHAR(10) NOT NULL,
  entry_date DATE NOT NULL,
  current_tax_cents BIGINT NOT NULL,
  deferred_tax_cents BIGINT NOT NULL DEFAULT 0,
  withholdings_cents BIGINT NOT NULL DEFAULT 0,
  draft_current_tax_cents BIGINT NULL,
  difference_from_draft_cents BIGINT NULL,
  note VARCHAR(500) NULL,
  document_id BIGINT UNSIGNED NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  reversal_entry_id BIGINT UNSIGNED NULL,
  reversed_by VARCHAR(100) NULL,
  reversed_at BIGINT NULL,
  reverse_reason VARCHAR(300) NULL,
  live_year SMALLINT UNSIGNED GENERATED ALWAYS AS (IF(reversed_at IS NULL, year, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_tax_corporate_entry_source (source_key),
  UNIQUE KEY uq_fin_tax_corporate_entry_seq (year, seq),
  UNIQUE KEY uq_fin_tax_corporate_entry_live (live_year),
  CONSTRAINT fk_fin_tax_corporate_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_tax_corporate_entry_reversal FOREIGN KEY (reversal_entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_tax_corporate_entry_document FOREIGN KEY (document_id) REFERENCES fin_documents (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_analysis_settings (
  id TINYINT UNSIGNED NOT NULL,
  stripe_fees_treatment VARCHAR(16) NOT NULL DEFAULT 'direct_cost',
  bank_fee_accounts_json TEXT NULL,
  configured_by VARCHAR(100) NOT NULL,
  configured_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT ck_fin_analysis_settings_single CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
