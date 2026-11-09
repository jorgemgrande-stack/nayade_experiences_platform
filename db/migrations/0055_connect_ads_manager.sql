-- Big Elephant — Elephant Connect · Ads Manager (server/adsManager, capacidad ads-manager): inversión y resultados de las
-- campañas de publicidad de la empresa (Meta Ads y Google Ads) en un solo panel, medidos con sus ventas reales. Aditiva,
-- BD de cada empresa. Solo crea tablas nuevas (prefijo ads_); no modifica ninguna existente. Nunca se ejecuta al arrancar.
--
-- `ads_settings`: una fila (id = 1) con la importación automática diaria (encendida por defecto: sin credenciales en la
--   bóveda no hace nada) y el umbral de la alerta «campaña sin conversiones».
-- `ads_campaigns`: cada campaña por plataforma y su identificador en ella (clave natural), con su código UTM para
--   atribuir las ventas (por defecto, el de la plataforma o el que traiga el CSV). Solo lectura: nunca se crean ni se
--   modifican campañas en las plataformas.
-- `ads_daily_metrics`: coste (céntimos), impresiones, clics y conversiones que declara la plataforma por campaña y día
--   (AAAA-MM-DD del día de la cuenta). Clave natural (campaña, día): reimportar corrige, nunca duplica.
-- `ads_sync_runs`: cada importación (API o CSV) con su rango, resultado y el error en lenguaje claro.
-- `ads_sale_tags`: la etiqueta de origen (utm_source, utm_campaign, gclid, fbclid…) de una venta del Core (reserva), la
--   que el Core aún no guarda en la reserva: llega por CSV (p. ej. el informe de transacciones de Google Analytics) o a
--   mano. Una etiqueta por reserva.
-- `ads_budgets`: presupuesto mensual previsto (total, por plataforma o por campaña) para las alertas de gasto.

CREATE TABLE IF NOT EXISTS ads_settings (
  id                       TINYINT UNSIGNED NOT NULL,
  auto_sync                TINYINT(1)       NOT NULL DEFAULT 1,
  no_conv_min_spend_cents  INT UNSIGNED     NOT NULL DEFAULT 3000,
  no_conv_days             TINYINT UNSIGNED NOT NULL DEFAULT 14,
  updated_by               INT              NULL DEFAULT NULL,
  updated_at               DATETIME(3)      NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_ads_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ads_campaigns (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  platform      VARCHAR(16)   NOT NULL,
  external_id   VARCHAR(64)   NOT NULL,
  account_id    VARCHAR(32)   NULL DEFAULT NULL,
  name          VARCHAR(255)  NOT NULL,
  utm_campaign  VARCHAR(160)  NULL DEFAULT NULL,
  currency      CHAR(3)       NOT NULL DEFAULT 'EUR',
  source        VARCHAR(8)    NOT NULL DEFAULT 'api',
  first_day     CHAR(10)      NULL DEFAULT NULL,
  last_day      CHAR(10)      NULL DEFAULT NULL,
  is_archived   TINYINT(1)    NOT NULL DEFAULT 0,
  created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_campaigns_external (platform, external_id),
  KEY idx_ads_campaigns_utm (utm_campaign)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ads_daily_metrics (
  campaign_id         INT UNSIGNED    NOT NULL,
  day                 CHAR(10)        NOT NULL,
  spend_cents         BIGINT          NOT NULL DEFAULT 0,
  impressions         BIGINT UNSIGNED NOT NULL DEFAULT 0,
  clicks              BIGINT UNSIGNED NOT NULL DEFAULT 0,
  conversions         DECIMAL(12,2)   NULL DEFAULT NULL,
  conversion_value_cents BIGINT       NULL DEFAULT NULL,
  source              VARCHAR(8)      NOT NULL DEFAULT 'api',
  run_id              INT UNSIGNED    NULL DEFAULT NULL,
  updated_at          DATETIME(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (campaign_id, day),
  KEY idx_ads_daily_metrics_day (day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ads_sync_runs (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  platform       VARCHAR(16)   NOT NULL,
  kind           VARCHAR(8)    NOT NULL,
  trigger_source VARCHAR(12)   NOT NULL DEFAULT 'manual',
  range_start    CHAR(10)      NULL DEFAULT NULL,
  range_end      CHAR(10)      NULL DEFAULT NULL,
  status         VARCHAR(12)   NOT NULL DEFAULT 'running',
  rows_upserted  INT UNSIGNED  NOT NULL DEFAULT 0,
  rows_skipped   INT UNSIGNED  NOT NULL DEFAULT 0,
  error_kind     VARCHAR(24)   NULL DEFAULT NULL,
  error_message  VARCHAR(500)  NULL DEFAULT NULL,
  file_name      VARCHAR(190)  NULL DEFAULT NULL,
  created_by     INT           NULL DEFAULT NULL,
  started_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at    DATETIME(3)   NULL DEFAULT NULL,
  PRIMARY KEY (id),
  KEY idx_ads_sync_runs_platform (platform, kind, status, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ads_sale_tags (
  reservation_id INT           NOT NULL,
  utm_source     VARCHAR(120)  NULL DEFAULT NULL,
  utm_medium     VARCHAR(120)  NULL DEFAULT NULL,
  utm_campaign   VARCHAR(160)  NULL DEFAULT NULL,
  gclid          VARCHAR(255)  NULL DEFAULT NULL,
  fbclid         VARCHAR(255)  NULL DEFAULT NULL,
  source         VARCHAR(8)    NOT NULL DEFAULT 'csv',
  run_id         INT UNSIGNED  NULL DEFAULT NULL,
  created_by     INT           NULL DEFAULT NULL,
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (reservation_id),
  KEY idx_ads_sale_tags_campaign (utm_campaign)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ads_budgets (
  id             INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  scope_key      VARCHAR(40)   NOT NULL,
  scope          VARCHAR(12)   NOT NULL,
  platform       VARCHAR(16)   NULL DEFAULT NULL,
  campaign_id    INT UNSIGNED  NULL DEFAULT NULL,
  monthly_cents  BIGINT        NOT NULL,
  is_archived    TINYINT(1)    NOT NULL DEFAULT 0,
  updated_by     INT           NULL DEFAULT NULL,
  created_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ads_budgets_scope (scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
