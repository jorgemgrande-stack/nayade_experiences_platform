-- ============================================================================
-- Elephant Resource Manager — BD de métricas de uso v1
--
-- Separada del registro (el Core tiene allí solo lectura) y de las BD de los tenants.
-- Solo cantidades agregadas por hora: sin datos personales ni contenido de negocio.
-- ============================================================================

CREATE TABLE IF NOT EXISTS usage_hourly (
  tenant_id  VARCHAR(63)  NOT NULL,
  metric     VARCHAR(64)  NOT NULL,
  hour_start TIMESTAMP(3) NOT NULL,
  quantity   DOUBLE       NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, metric, hour_start),
  KEY idx_usage_metric_hour (metric, hour_start)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
