-- Big Elephant — Marketplace del panel: tipos de entrada del catálogo (solo añade valores al ENUM).
--
-- `web_entries.kind` admite `marketplace_slide` (campañas del carrusel, con borrador y publicación como el resto del
-- catálogo) y `marketplace` (ajustes del carrusel y cabeceras de marca, clave única `settings`). Añadir valores al
-- final de un ENUM es un cambio de metadatos: no reescribe la tabla ni cambia ninguna fila existente.

ALTER TABLE web_entries
  MODIFY kind ENUM('product','promotion','faq','menu','seo','page','forms','capability','marketplace_slide','marketplace') NOT NULL;
