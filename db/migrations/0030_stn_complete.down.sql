-- Reversión de 0030_stn_complete: se pierden las reglas de participación, el registro de hechos premiados, la posición
-- de la recuperación y la exclusividad de las recompensas (los movimientos del libro de puntos se conservan y las
-- campañas con alcance de comunidad dejan de aplicarse). Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS loyalty_reward_communities;
DROP TABLE IF EXISTS loyalty_community_sync;
DROP TABLE IF EXISTS loyalty_community_awards;
DROP TABLE IF EXISTS loyalty_community_rules;
