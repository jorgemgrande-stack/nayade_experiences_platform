-- Elephant SEO Control (server/seoControlDb.ts, capacidad seo-control): palabras clave de la empresa y su URL objetivo,
-- posiciones por día (anotadas a mano o importadas de su Google Search Console), rendimiento por consulta y página de
-- Search Console, ejecuciones (importaciones, auditorías y sincronizaciones), páginas de cada auditoría on-page y las
-- reseñas externas leídas de Google Business Profile y TripAdvisor. Fechas de calendario como texto AAAA-MM-DD.
-- Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS seo_keywords (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  keyword     VARCHAR(191) NOT NULL,
  target_url  VARCHAR(512) NULL,
  is_archived TINYINT(1)   NOT NULL DEFAULT 0,
  created_by  INT          NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seo_keywords_keyword (keyword),
  KEY idx_seo_keywords_active (is_archived)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seo_positions (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  keyword_id  INT UNSIGNED  NOT NULL,
  observed_on CHAR(10)      NOT NULL,
  source      VARCHAR(12)   NOT NULL DEFAULT 'manual',
  position    DECIMAL(6,1)  NULL,
  clicks      INT UNSIGNED  NULL,
  impressions INT UNSIGNED  NULL,
  ranking_url VARCHAR(512)  NULL,
  note        VARCHAR(500)  NULL,
  recorded_by INT           NULL,
  created_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seo_positions_day (keyword_id, observed_on, source),
  KEY idx_seo_positions_date (observed_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seo_search_performance (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  natural_key  CHAR(64)      NOT NULL,
  period_start CHAR(10)      NOT NULL,
  period_end   CHAR(10)      NOT NULL,
  query_text   VARCHAR(255)  NOT NULL,
  page_url     VARCHAR(512)  NULL,
  clicks       INT UNSIGNED  NOT NULL DEFAULT 0,
  impressions  INT UNSIGNED  NOT NULL DEFAULT 0,
  ctr          DECIMAL(7,5)  NOT NULL DEFAULT 0,
  position     DECIMAL(6,1)  NOT NULL DEFAULT 0,
  imported_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seo_search_performance_key (natural_key),
  KEY idx_seo_search_performance_period (period_end, impressions)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seo_runs (
  id          INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  kind        VARCHAR(16)   NOT NULL,
  status      VARCHAR(12)   NOT NULL DEFAULT 'running',
  summary     VARCHAR(1000) NULL,
  error       VARCHAR(500)  NULL,
  started_by  INT           NULL,
  started_at  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  finished_at TIMESTAMP(3)  NULL,
  PRIMARY KEY (id),
  KEY idx_seo_runs_kind (kind, started_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seo_audit_pages (
  id               INT UNSIGNED      NOT NULL AUTO_INCREMENT,
  run_id           INT UNSIGNED      NOT NULL,
  url              VARCHAR(512)      NOT NULL,
  final_url        VARCHAR(512)      NULL,
  status_code      SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  fetch_error      VARCHAR(300)      NULL,
  title            VARCHAR(300)      NULL,
  meta_description VARCHAR(500)      NULL,
  h1               VARCHAR(300)      NULL,
  h1_count         SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  canonical        VARCHAR(512)      NULL,
  robots           VARCHAR(200)      NULL,
  indexable        TINYINT(1)        NOT NULL DEFAULT 0,
  size_bytes       INT UNSIGNED      NOT NULL DEFAULT 0,
  load_ms          INT UNSIGNED      NOT NULL DEFAULT 0,
  issues           VARCHAR(500)      NULL,
  broken_links     VARCHAR(4000)     NULL,
  PRIMARY KEY (id),
  KEY idx_seo_audit_pages_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS seo_external_reviews (
  id           INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  source       VARCHAR(16)      NOT NULL,
  external_id  VARCHAR(191)     NOT NULL,
  author_name  VARCHAR(200)     NULL,
  rating       TINYINT UNSIGNED NOT NULL,
  title        VARCHAR(300)     NULL,
  body         TEXT             NULL,
  review_date  CHAR(10)         NULL,
  reply_text   TEXT             NULL,
  replied_at   VARCHAR(40)      NULL,
  review_url   VARCHAR(512)     NULL,
  imported_at  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at   TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_seo_external_reviews_ext (source, external_id),
  KEY idx_seo_external_reviews_date (source, review_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
