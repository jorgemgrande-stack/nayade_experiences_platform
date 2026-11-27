-- Reversión de 0096_acc_sync_runs.sql: elimina solo la traza de ejecuciones (ningún asiento ni ajuste depende de ella).
DROP TABLE IF EXISTS acc_sync_runs;
