-- Big Elephant — Estado y comprobaciones de las integraciones de cada empresa (aditiva, BD de cada empresa).
--
-- `integration_status`: el ÚLTIMO estado de cada proveedor (última comprobación, última sincronización y último error).
-- `integration_events`: historial de comprobaciones manuales y de CAMBIOS de estado de las sincronizaciones
-- (incidencias), no de cada pasada correcta. Ningún secreto: solo resultado, mensaje genérico y autor.
--
-- Solo crea tablas nuevas. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS integration_status (
  provider            VARCHAR(32)  NOT NULL,
  last_check_at       TIMESTAMP(3) NULL DEFAULT NULL,
  last_check_outcome  VARCHAR(16)  NULL DEFAULT NULL,
  last_check_message  VARCHAR(300) NULL DEFAULT NULL,
  last_check_by       VARCHAR(100) NULL DEFAULT NULL,
  last_sync_at        TIMESTAMP(3) NULL DEFAULT NULL,
  last_sync_outcome   VARCHAR(16)  NULL DEFAULT NULL,
  last_sync_message   VARCHAR(300) NULL DEFAULT NULL,
  last_ok_sync_at     TIMESTAMP(3) NULL DEFAULT NULL,
  last_error_at       TIMESTAMP(3) NULL DEFAULT NULL,
  last_error_message  VARCHAR(300) NULL DEFAULT NULL,
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS integration_events (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  provider    VARCHAR(32)  NOT NULL,
  kind        VARCHAR(16)  NOT NULL,
  outcome     VARCHAR(16)  NOT NULL,
  message     VARCHAR(300) NOT NULL,
  actor       VARCHAR(100) NULL DEFAULT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_integration_events_provider (provider, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
