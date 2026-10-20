-- Reversión de 0022_consumer_withdrawals: borra las solicitudes de desistimiento y su historial. En live, EXPORTARLAS
-- antes: son la prueba de la recepción y de la resolución ante el consumidor.
DROP TABLE consumer_withdrawal_events;
DROP TABLE consumer_withdrawals;
