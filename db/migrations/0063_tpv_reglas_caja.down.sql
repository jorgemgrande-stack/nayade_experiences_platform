DROP TABLE IF EXISTS tpv_session_corrections;
DROP TABLE IF EXISTS tpv_session_closures;
ALTER TABLE cash_sessions DROP INDEX uq_cash_sessions_close_key, DROP INDEX uq_cash_sessions_open_key, DROP COLUMN close_key, DROP COLUMN open_key;
ALTER TABLE cash_movements DROP INDEX uq_cash_movements_idempotency_key, DROP COLUMN idempotency_key;
ALTER TABLE cash_registers DROP COLUMN cutoff_time;
