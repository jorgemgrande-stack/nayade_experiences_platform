-- Reversión de 0042_marketplace_events: se pierde la medición del marketplace.
DROP TABLE IF EXISTS marketplace_event_keys;
DROP TABLE IF EXISTS marketplace_event_counts;
