-- Big Elephant — Marketplace del panel de cada empresa (aditiva).
--
-- `web_entries.kind` admite `marketplace_slide` (campañas del carrusel, con borrador y publicación como el resto del
--   catálogo) y `marketplace` (ajustes del carrusel y cabeceras de marca, clave única `settings`). Añadir valores al
--   final de un ENUM es un cambio de metadatos: no reescribe la tabla.
-- `marketplace_event_counts`: medición AGREGADA por día, empresa, tipo de evento, producto y campaña. Sin datos
--   personales: ni usuario, ni IP, ni navegador.
-- `marketplace_event_keys`: identificadores de evento ya contados (deduplicación); se purgan pasados unos días.

ALTER TABLE web_entries
  MODIFY kind ENUM('product','promotion','faq','menu','seo','page','forms','capability','marketplace_slide','marketplace') NOT NULL;

CREATE TABLE marketplace_event_counts (
  day DATE NOT NULL,
  tenant_id VARCHAR(63) NOT NULL,
  event_type VARCHAR(24) NOT NULL,
  product_key VARCHAR(64) NOT NULL DEFAULT '',
  slide_id VARCHAR(64) NOT NULL DEFAULT '',
  count INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (day, tenant_id, event_type, product_key, slide_id),
  KEY idx_marketplace_event_counts_day (day, event_type)
);

CREATE TABLE marketplace_event_keys (
  event_id CHAR(36) NOT NULL PRIMARY KEY,
  received_at DATETIME NOT NULL,
  KEY idx_marketplace_event_keys_received (received_at)
);
