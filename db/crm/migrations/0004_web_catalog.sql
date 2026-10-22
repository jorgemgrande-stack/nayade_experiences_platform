-- Catálogo comercial y contenidos de la web pública (www.bigelephant.es), administrados desde el CRM.
--
-- Un único modelo editorial para todo lo publicable: cada ENTRADA (producto, promoción, FAQ, menú,
-- SEO, página o ajustes de formularios) tiene un borrador versionado y, si se publica, una copia
-- publicada independiente. La web solo ve lo publicado.
--
-- Los productos REFERENCIAN el mecanismo técnico (módulo de licencia o plan de facturación); no lo
-- duplican. Los precios son filas inmutables con aprobación: cambiar un precio crea otra fila. Los
-- contratos y facturas conservan sus propios importes, así que nada de esto es retroactivo.
-- Aditiva: no modifica tablas existentes.

CREATE TABLE web_entries (
  id INT AUTO_INCREMENT PRIMARY KEY,
  kind ENUM('product','promotion','faq','menu','seo','page','forms') NOT NULL,
  entry_key VARCHAR(80) NOT NULL,
  -- Solo productos: core_plan | extension | industry_module | usage | service
  family VARCHAR(20) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  publication ENUM('draft','published','unpublished') NOT NULL DEFAULT 'draft',
  draft JSON NOT NULL,
  draft_version INT NOT NULL DEFAULT 1,
  published JSON NULL,
  published_version INT NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by VARCHAR(100) NOT NULL,
  published_at BIGINT NULL,
  published_by VARCHAR(100) NULL,
  UNIQUE KEY uq_web_entry (kind, entry_key),
  KEY idx_web_entry_publication (kind, publication)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Historial inmutable de borradores (cada guardado o restauración es una versión)
CREATE TABLE web_entry_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_id INT NOT NULL,
  version INT NOT NULL,
  snapshot JSON NOT NULL,
  author VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_web_entry_version (entry_id, version),
  CONSTRAINT fk_web_version_entry FOREIGN KEY (entry_id) REFERENCES web_entries (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Precios de productos: importe inmutable; borrador → aprobado (visible si el producto está
-- publicado) → retirado. Nunca se borran salvo los borradores.
CREATE TABLE web_prices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entry_id INT NOT NULL,
  kind ENUM('monthly','yearly','one_time','usage') NOT NULL,
  amount_cents BIGINT NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'EUR',
  -- Unidad de consumo (minuto, mensaje, envío…) para kind = usage
  unit VARCHAR(40) NULL,
  -- Tipo impositivo en puntos básicos (2100 = 21 %) y si el importe lo incluye
  tax_rate_bp INT NOT NULL,
  tax_included TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('draft','approved','retired') NOT NULL DEFAULT 'draft',
  note VARCHAR(300) NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  approved_at BIGINT NULL,
  approved_by VARCHAR(100) NULL,
  retired_at BIGINT NULL,
  retired_by VARCHAR(100) NULL,
  KEY idx_web_price_entry (entry_id, status),
  CONSTRAINT fk_web_price_entry FOREIGN KEY (entry_id) REFERENCES web_entries (id),
  CONSTRAINT chk_web_price_amount CHECK (amount_cents >= 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Auditoría de la administración de la web (solo inserciones)
CREATE TABLE web_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  entity VARCHAR(20) NOT NULL,
  entity_key VARCHAR(120) NOT NULL,
  action VARCHAR(30) NOT NULL,
  author VARCHAR(100) NOT NULL,
  detail VARCHAR(500) NULL,
  created_at BIGINT NOT NULL,
  KEY idx_web_event_entity (entity, entity_key),
  KEY idx_web_event_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
