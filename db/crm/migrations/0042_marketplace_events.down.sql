-- Reversión de 0042_marketplace_events: se pierden la medición y las imágenes del marketplace.
DROP TABLE IF EXISTS marketplace_media_files;
DROP TABLE IF EXISTS marketplace_media;
DROP TABLE IF EXISTS marketplace_event_keys;
DROP TABLE IF EXISTS marketplace_event_counts;
