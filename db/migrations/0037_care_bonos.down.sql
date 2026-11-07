-- Reversión de 0037_care_bonos: se pierden las definiciones de bonos, los bonos vendidos con su saldo y el historial
-- de consumos (las ventas del TPV que los cobraron y las reservas de SPA se conservan). Antes, desplegar el código
-- anterior a este cambio.
DROP TABLE IF EXISTS care_pack_consumptions;
DROP TABLE IF EXISTS care_pack_purchases;
DROP TABLE IF EXISTS care_session_packs;
