-- Reversión de 0043_marketplace_kinds: se pierden las campañas del carrusel, sus ajustes y su historial.
DELETE v FROM web_entry_versions v JOIN web_entries e ON e.id = v.entry_id WHERE e.kind IN ('marketplace_slide','marketplace');
DELETE FROM web_entries WHERE kind IN ('marketplace_slide','marketplace');
ALTER TABLE web_entries
  MODIFY kind ENUM('product','promotion','faq','menu','seo','page','forms','capability') NOT NULL;
