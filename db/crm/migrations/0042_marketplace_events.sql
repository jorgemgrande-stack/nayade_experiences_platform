-- Big Elephant — Medición del marketplace del panel de cada empresa (aditiva).
--
-- `marketplace_event_counts`: medición AGREGADA por día, empresa, tipo de evento, producto y campaña. Sin datos
--   personales: ni usuario, ni IP, ni navegador.
-- `marketplace_event_keys`: identificadores de evento ya contados (deduplicación); se purgan pasados unos días.

CREATE TABLE marketplace_event_counts (
  day DATE NOT NULL,
  tenant_id VARCHAR(63) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  product_key VARCHAR(64) NOT NULL DEFAULT '',
  slide_id VARCHAR(64) NOT NULL DEFAULT '',
  count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tenant_id, event_type, product_key, slide_id),
  KEY idx_marketplace_event_counts_day (day, event_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE marketplace_event_keys (
  event_id CHAR(36) NOT NULL PRIMARY KEY,
  received_at DATETIME NOT NULL,
  KEY idx_marketplace_event_keys_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- `marketplace_media`: imágenes oficiales del marketplace (fichas, campañas y cabeceras), subidas desde el CRM. Una fila
--   por imagen original (id = huella del contenido), con su texto alternativo obligatorio y quién la subió.
-- `marketplace_media_files`: las variantes optimizadas que se sirven (formato y ancho), inmutables.
CREATE TABLE marketplace_media (
  id CHAR(32) NOT NULL PRIMARY KEY,
  alt VARCHAR(160) NOT NULL,
  width INT UNSIGNED NOT NULL,
  height INT UNSIGNED NOT NULL,
  bytes INT UNSIGNED NOT NULL,
  created_at BIGINT NOT NULL,
  created_by VARCHAR(100) NOT NULL,
  KEY idx_marketplace_media_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE marketplace_media_files (
  media_id CHAR(32) NOT NULL,
  variant VARCHAR(24) NOT NULL,
  content_type VARCHAR(40) NOT NULL,
  width INT UNSIGNED NOT NULL,
  data MEDIUMBLOB NOT NULL,
  PRIMARY KEY (media_id, variant),
  CONSTRAINT fk_marketplace_media_files FOREIGN KEY (media_id) REFERENCES marketplace_media (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
