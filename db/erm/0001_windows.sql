-- ============================================================================
-- Elephant Resource Manager — contadores compartidos por ventana v1
--
-- Una fila por (empresa, métrica, periodo) con su ventana vigente, que todas las réplicas incrementan con un UPSERT
-- atómico (value = LAST_INSERT_ID(value + ?)). Limitador de tasa distribuido (periodo minute) y cuotas
-- día/mes que sobreviven a los reinicios. Solo cantidades agregadas: sin datos personales.
-- window_start en ms UTC (BIGINT): independiente de la zona horaria de cada conexión.
-- Retención sin borrados: la primera escritura de una ventana nueva reutiliza la fila y pone el valor a cero (el
-- histórico vive en usage_hourly). El usuario es_erm tiene solo SELECT, INSERT, UPDATE, como en usage_hourly.
-- Se aplica desde el código (server/_core/erm/setup.ts, acción medicion-preparar).
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_windows (
  tenant_id    VARCHAR(63) NOT NULL,
  metric       VARCHAR(64) NOT NULL,
  period       VARCHAR(8)  NOT NULL,
  window_start BIGINT      NOT NULL,
  value        BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, metric, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
