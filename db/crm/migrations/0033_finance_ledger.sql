-- Big Elephant — Finanzas corporativas, fase 1A: libro contable de partida doble (aditiva, base del CRM).
--
-- Contabilidad de IRON ELEPHANT CONSULTING, S.L. (la empresa que vende el SaaS), nunca de los tenants. Importes en
-- céntimos enteros, tipos en puntos básicos y fechas contables DATE (zona Europe/Madrid).
--
-- `fin_accounts`: plan contable (subconjunto del PGC de pymes sembrado aquí; las subcuentas se crean por la API).
-- `fin_fiscal_years` y `fin_periods`: ejercicios y sus doce periodos mensuales, abiertos o cerrados. La fila del
--   ejercicio guarda el siguiente número de asiento: se bloquea al contabilizar (numeración correlativa sin huecos).
-- `fin_journals`: diarios (general, ventas, compras, bancos, caja, Stripe, nóminas, impuestos, apertura,
--   regularización y cierre).
-- `fin_entries`: asientos. Borrador (sin número), contabilizado (número correlativo del ejercicio, inmutable) o
--   anulado (solo borradores). Cada asiento generado lleva `source_key` única: repetir una sincronización no crea
--   nada. Un asiento contabilizado se corrige con su reversión (`reverses_entry_id` / `reversed_by_entry_id`).
-- `fin_entry_lines`: líneas con debe o haber, cuenta y referencias opcionales (centro de coste, proveedor, empresa
--   cliente del CRM solo como referencia, tipo y base del impuesto).
-- `fin_audit_log`: traza de cada acción de escritura (solo se añaden filas).
-- Sin estas tablas el plano de control funciona igual: el módulo de finanzas no se monta.
--
-- irreversible: los libros contables se conservan seis años por obligación legal (art. 30 del Código de Comercio); el código anterior ignora estas tablas, así que volver atrás no exige quitarlas.

CREATE TABLE fin_accounts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(12) NOT NULL,
  name VARCHAR(160) NOT NULL,
  type VARCHAR(12) NOT NULL,
  parent_code VARCHAR(12) NULL,
  is_postable TINYINT(1) NOT NULL DEFAULT 1,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_account_code (code),
  KEY ix_fin_account_parent (parent_code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_fiscal_years (
  year SMALLINT UNSIGNED NOT NULL,
  status VARCHAR(8) NOT NULL,
  next_entry_number INT UNSIGNED NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  closed_at BIGINT NULL,
  closed_by VARCHAR(100) NULL,
  PRIMARY KEY (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_periods (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  month TINYINT UNSIGNED NOT NULL,
  status VARCHAR(8) NOT NULL,
  closed_at BIGINT NULL,
  closed_by VARCHAR(100) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_period (year, month),
  CONSTRAINT fk_fin_period_year FOREIGN KEY (year) REFERENCES fin_fiscal_years (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_journals (
  code VARCHAR(4) NOT NULL,
  name VARCHAR(80) NOT NULL,
  PRIMARY KEY (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_entries (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  year SMALLINT UNSIGNED NOT NULL,
  number INT UNSIGNED NULL,
  journal_code VARCHAR(4) NOT NULL,
  entry_date DATE NOT NULL,
  description VARCHAR(500) NOT NULL,
  origin VARCHAR(16) NOT NULL,
  source_key VARCHAR(160) NULL,
  status VARCHAR(8) NOT NULL,
  reverses_entry_id BIGINT UNSIGNED NULL,
  reversed_by_entry_id BIGINT UNSIGNED NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  posted_by VARCHAR(100) NULL,
  posted_at BIGINT NULL,
  voided_by VARCHAR(100) NULL,
  voided_at BIGINT NULL,
  void_reason VARCHAR(300) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_entry_source (source_key),
  UNIQUE KEY uq_fin_entry_number (year, number),
  KEY ix_fin_entry_date (status, entry_date),
  KEY ix_fin_entry_journal (journal_code, entry_date),
  KEY ix_fin_entry_origin (origin, entry_date),
  CONSTRAINT fk_fin_entry_journal FOREIGN KEY (journal_code) REFERENCES fin_journals (code),
  CONSTRAINT fk_fin_entry_year FOREIGN KEY (year) REFERENCES fin_fiscal_years (year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_entry_lines (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entry_id BIGINT UNSIGNED NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  account_code VARCHAR(12) NOT NULL,
  debit_cents BIGINT NOT NULL DEFAULT 0,
  credit_cents BIGINT NOT NULL DEFAULT 0,
  description VARCHAR(300) NULL,
  cost_center_id BIGINT UNSIGNED NULL,
  supplier_id BIGINT UNSIGNED NULL,
  company_id BIGINT UNSIGNED NULL,
  tax_rate_bp INT NULL,
  tax_base_cents BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_entry_line (entry_id, line_no),
  KEY ix_fin_line_account (account_code, entry_id),
  CONSTRAINT fk_fin_line_entry FOREIGN KEY (entry_id) REFERENCES fin_entries (id),
  CONSTRAINT fk_fin_line_account FOREIGN KEY (account_code) REFERENCES fin_accounts (code),
  CONSTRAINT ck_fin_line_side CHECK ((debit_cents > 0 AND credit_cents = 0) OR (credit_cents > 0 AND debit_cents = 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_audit_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(30) NOT NULL,
  entity_id VARCHAR(64) NULL,
  summary JSON NULL,
  request_id VARCHAR(64) NULL,
  PRIMARY KEY (id),
  KEY ix_fin_audit_action (action, id),
  KEY ix_fin_audit_entity (entity, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT INTO fin_journals (code, name) VALUES
  ('GEN', 'General'),
  ('VEN', 'Ventas'),
  ('COM', 'Compras y gastos'),
  ('BAN', 'Bancos'),
  ('CAJ', 'Caja'),
  ('STR', 'Stripe'),
  ('NOM', 'Nóminas'),
  ('IMP', 'Impuestos'),
  ('APE', 'Apertura'),
  ('REG', 'Regularización'),
  ('CIE', 'Cierre');

INSERT INTO fin_accounts (code, name, type, parent_code, is_postable, active, created_at) VALUES
  ('100', 'Capital social', 'equity', NULL, 1, 1, 0),
  ('112', 'Reserva legal', 'equity', NULL, 1, 1, 0),
  ('113', 'Reservas voluntarias', 'equity', NULL, 1, 1, 0),
  ('120', 'Remanente', 'equity', NULL, 1, 1, 0),
  ('121', 'Resultados negativos de ejercicios anteriores', 'equity', NULL, 1, 1, 0),
  ('129', 'Resultado del ejercicio', 'equity', NULL, 1, 1, 0),
  ('170', 'Deudas a largo plazo con entidades de crédito', 'liability', NULL, 1, 1, 0),
  ('400', 'Proveedores', 'liability', NULL, 1, 1, 0),
  ('410', 'Acreedores por prestaciones de servicios', 'liability', NULL, 1, 1, 0),
  ('430', 'Clientes', 'asset', NULL, 1, 1, 0),
  ('436', 'Clientes de dudoso cobro', 'asset', NULL, 1, 1, 0),
  ('438', 'Anticipos de clientes', 'liability', NULL, 1, 1, 0),
  ('440', 'Deudores', 'asset', NULL, 1, 1, 0),
  ('460', 'Anticipos de remuneraciones', 'asset', NULL, 1, 1, 0),
  ('465', 'Remuneraciones pendientes de pago', 'liability', NULL, 1, 1, 0),
  ('470', 'Hacienda Pública, deudora por diversos conceptos', 'asset', NULL, 0, 1, 0),
  ('4700', 'Hacienda Pública, deudora por IVA', 'asset', '470', 1, 1, 0),
  ('4709', 'Hacienda Pública, deudora por devolución de impuestos', 'asset', '470', 1, 1, 0),
  ('471', 'Organismos de la Seguridad Social, deudores', 'asset', NULL, 1, 1, 0),
  ('472', 'Hacienda Pública, IVA soportado', 'asset', NULL, 1, 1, 0),
  ('473', 'Hacienda Pública, retenciones y pagos a cuenta', 'asset', NULL, 1, 1, 0),
  ('475', 'Hacienda Pública, acreedora por conceptos fiscales', 'liability', NULL, 0, 1, 0),
  ('4750', 'Hacienda Pública, acreedora por IVA', 'liability', '475', 1, 1, 0),
  ('4751', 'Hacienda Pública, acreedora por retenciones practicadas', 'liability', '475', 1, 1, 0),
  ('4752', 'Hacienda Pública, acreedora por impuesto sobre sociedades', 'liability', '475', 1, 1, 0),
  ('476', 'Organismos de la Seguridad Social, acreedores', 'liability', NULL, 1, 1, 0),
  ('477', 'Hacienda Pública, IVA repercutido', 'liability', NULL, 1, 1, 0),
  ('520', 'Deudas a corto plazo con entidades de crédito', 'liability', NULL, 1, 1, 0),
  ('551', 'Cuenta corriente con socios y administradores', 'asset', NULL, 1, 1, 0),
  ('555', 'Partidas pendientes de aplicación', 'asset', NULL, 1, 1, 0),
  ('570', 'Caja, euros', 'asset', NULL, 1, 1, 0),
  ('572', 'Bancos e instituciones de crédito c/c vista, euros', 'asset', NULL, 0, 1, 0),
  ('5720', 'Stripe: saldo en la pasarela de pago', 'asset', '572', 1, 1, 0),
  ('600', 'Compras de mercaderías', 'expense', NULL, 1, 1, 0),
  ('621', 'Arrendamientos y cánones', 'expense', NULL, 1, 1, 0),
  ('622', 'Reparaciones y conservación', 'expense', NULL, 1, 1, 0),
  ('623', 'Servicios de profesionales independientes', 'expense', NULL, 1, 1, 0),
  ('624', 'Transportes', 'expense', NULL, 1, 1, 0),
  ('625', 'Primas de seguros', 'expense', NULL, 1, 1, 0),
  ('626', 'Servicios bancarios y similares', 'expense', NULL, 1, 1, 0),
  ('627', 'Publicidad, propaganda y relaciones públicas', 'expense', NULL, 1, 1, 0),
  ('628', 'Suministros', 'expense', NULL, 1, 1, 0),
  ('629', 'Otros servicios', 'expense', NULL, 1, 1, 0),
  ('630', 'Impuesto sobre beneficios', 'expense', NULL, 1, 1, 0),
  ('631', 'Otros tributos', 'expense', NULL, 1, 1, 0),
  ('640', 'Sueldos y salarios', 'expense', NULL, 1, 1, 0),
  ('642', 'Seguridad Social a cargo de la empresa', 'expense', NULL, 1, 1, 0),
  ('649', 'Otros gastos sociales', 'expense', NULL, 1, 1, 0),
  ('662', 'Intereses de deudas', 'expense', NULL, 1, 1, 0),
  ('669', 'Otros gastos financieros', 'expense', NULL, 1, 1, 0),
  ('678', 'Gastos excepcionales', 'expense', NULL, 1, 1, 0),
  ('681', 'Amortización del inmovilizado material', 'expense', NULL, 1, 1, 0),
  ('705', 'Prestaciones de servicios', 'income', NULL, 1, 1, 0),
  ('706', 'Descuentos sobre ventas por pronto pago', 'income', NULL, 1, 1, 0),
  ('708', 'Devoluciones de ventas y operaciones similares', 'income', NULL, 1, 1, 0),
  ('759', 'Ingresos por servicios diversos', 'income', NULL, 1, 1, 0),
  ('769', 'Otros ingresos financieros', 'income', NULL, 1, 1, 0),
  ('778', 'Ingresos excepcionales', 'income', NULL, 1, 1, 0);
