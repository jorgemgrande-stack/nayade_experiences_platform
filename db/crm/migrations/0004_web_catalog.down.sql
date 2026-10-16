-- Reversión de 0004_web_catalog (se pierden el catálogo comercial, los contenidos web y su historial).
DROP TABLE IF EXISTS web_events;
DROP TABLE IF EXISTS web_prices;
DROP TABLE IF EXISTS web_entry_versions;
DROP TABLE IF EXISTS web_entries;
