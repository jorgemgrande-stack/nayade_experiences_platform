-- Contabilidad general · traza independiente de cada ejecución de la sincronización de asientos (server/accountingGeneral).
-- Aditiva: solo crea una tabla nueva (acc_sync_runs, BD de cada empresa); no modifica ninguna tabla existente, no rellena
-- datos y no cambia asientos, importes, cuentas ni huellas. Nunca se ejecuta al arrancar.
--
-- Una fila por ejecución (incluidas las fallidas y las concurrentes, cada una con la suya):
--   actor / actor_user_id: quién la lanzó ('user:<id>' o 'sistema'); origin: manual | pantalla | programada.
--   status: running (en curso o interrumpida) | ok | partial (con errores, grupos sin leer o tope alcanzado) | error.
--   contadores: creados, reemplazados, revertidos, sin cambios, saltados (otra ejecución ya lo había hecho o no procedía),
--   diferidos, bloqueados y conflictos de concurrencia descartados.
--   warnings / error_summary: texto recortado, sin datos personales ni secretos (claves de documento y avisos genéricos).
-- El número 0096 se eligió porque la PR #1063 (newsletter) usa el 0095; la numeración definitiva se asigna al fusionar.

CREATE TABLE IF NOT EXISTS acc_sync_runs (
  id              BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id       VARCHAR(64)     NULL DEFAULT NULL,
  actor           VARCHAR(40)     NOT NULL,
  actor_user_id   INT             NULL DEFAULT NULL,
  origin          VARCHAR(12)     NOT NULL DEFAULT 'manual',
  status          VARCHAR(10)     NOT NULL DEFAULT 'running',
  started_at      DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at     DATETIME(3)     NULL DEFAULT NULL,
  created_count   INT             NOT NULL DEFAULT 0,
  replaced_count  INT             NOT NULL DEFAULT 0,
  reversed_count  INT             NOT NULL DEFAULT 0,
  unchanged_count INT             NOT NULL DEFAULT 0,
  skipped_count   INT             NOT NULL DEFAULT 0,
  deferred_count  INT             NOT NULL DEFAULT 0,
  blocked_count   INT             NOT NULL DEFAULT 0,
  conflict_count  INT             NOT NULL DEFAULT 0,
  error_count     INT             NOT NULL DEFAULT 0,
  truncated       TINYINT(1)      NOT NULL DEFAULT 0,
  warnings        VARCHAR(1000)   NULL DEFAULT NULL,
  error_summary   VARCHAR(2000)   NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_acc_sync_runs_started (started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
