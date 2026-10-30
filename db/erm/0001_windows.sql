-- ============================================================================
-- Elephant Resource Manager — contadores compartidos por ventana v1
--
-- Una fila por (empresa, métrica, periodo, inicio de ventana) que todas las réplicas incrementan con un UPSERT
-- atómico (value = LAST_INSERT_ID(value + ?)). Limitador de tasa distribuido (periodo minute) y cuotas
-- día/mes que sobreviven a los reinicios. Solo cantidades agregadas: sin datos personales.
-- window_start en ms UTC (BIGINT): independiente de la zona horaria de cada conexión.
-- Retención: el propio Core borra ventanas antiguas (minute 2 h, day 40 d, month 400 d); por eso el usuario es_erm
-- tiene DELETE SOLO sobre esta tabla. Se aplica desde el código (server/_core/erm/setup.ts, acción medicion-preparar).
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_windows (
  tenant_id    VARCHAR(63) NOT NULL,
  metric       VARCHAR(64) NOT NULL,
  period       VARCHAR(8)  NOT NULL,
  window_start BIGINT      NOT NULL,
  value        BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, metric, period, window_start),
  KEY idx_usage_windows_retention (period, window_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
