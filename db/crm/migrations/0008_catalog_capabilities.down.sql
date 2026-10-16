-- Reversión de 0008_catalog_capabilities: se pierden las entradas de capacidades y su historial
-- (los productos conservan sus listas de capacidades dentro del JSON, sin efecto).
DELETE v FROM web_entry_versions v JOIN web_entries e ON e.id = v.entry_id WHERE e.kind = 'capability';
DELETE FROM web_entries WHERE kind = 'capability';
ALTER TABLE web_entries
  MODIFY kind ENUM('product','promotion','faq','menu','seo','page','forms') NOT NULL;
