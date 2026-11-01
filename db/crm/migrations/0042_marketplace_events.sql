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
