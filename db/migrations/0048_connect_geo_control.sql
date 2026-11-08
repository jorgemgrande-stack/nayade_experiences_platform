-- Elephant GEO Control (server/geoControlDb.ts, capacidad geo-control): visibilidad de la marca de la empresa en las
-- respuestas de los motores de IA generativa. Ajustes de la marca (fila única), consultas que haría un cliente, las
-- observaciones de cada consulta por superficie (manuales o «asistidas», es decir, estimadas con la IA central) y las
-- oportunidades que detectan las reglas deterministas. Fechas de observación como texto AAAA-MM-DD. Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS geo_settings (
  id            TINYINT UNSIGNED NOT NULL,
  brand_name    VARCHAR(160)  NOT NULL,
  brand_aliases VARCHAR(1000) NULL,
  brand_domain  VARCHAR(255)  NULL,
  sector        VARCHAR(160)  NULL,
  zone          VARCHAR(160)  NULL,
  updated_by    INT           NULL,
  updated_at    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_geo_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS geo_queries (
  id          INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  query_text  VARCHAR(255)     NOT NULL,
  intent      VARCHAR(16)      NOT NULL DEFAULT 'non_branded',
  priority    TINYINT UNSIGNED NOT NULL DEFAULT 2,
  is_archived TINYINT(1)       NOT NULL DEFAULT 0,
  created_by  INT              NULL,
  created_at  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at  TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_geo_queries_text (query_text),
  KEY idx_geo_queries_active (is_archived, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS geo_observations (
  id              INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  query_id        INT UNSIGNED     NOT NULL,
  surface         VARCHAR(24)      NOT NULL,
  observed_on     CHAR(10)         NOT NULL,
  brand_mentioned TINYINT(1)       NOT NULL DEFAULT 0,
  domain_cited    TINYINT(1)       NOT NULL DEFAULT 0,
  cited_url       VARCHAR(512)     NULL,
  position        TINYINT UNSIGNED NULL,
  competitors     VARCHAR(2000)    NULL,
  note            VARCHAR(1000)    NULL,
  answer_summary  TEXT             NULL,
  source_method   VARCHAR(12)      NOT NULL DEFAULT 'manual',
  is_archived     TINYINT(1)       NOT NULL DEFAULT 0,
  recorded_by     INT              NULL,
  created_at      TIMESTAMP(3)     NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_geo_observations_query (query_id, surface, is_archived, observed_on),
  KEY idx_geo_observations_date (is_archived, observed_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS geo_opportunities (
  id                INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  natural_key       VARCHAR(191)  NOT NULL,
  opportunity_type  VARCHAR(24)   NOT NULL,
  query_id          INT UNSIGNED  NULL,
  surface           VARCHAR(24)   NULL,
  title             VARCHAR(300)  NOT NULL,
  reason            VARCHAR(1000) NOT NULL,
  suggested_action  VARCHAR(1000) NULL,
  priority          VARCHAR(8)    NOT NULL DEFAULT 'medium',
  status            VARCHAR(12)   NOT NULL DEFAULT 'open',
  evidence          VARCHAR(2000) NULL,
  last_evidence_on  CHAR(10)      NULL,
  status_note       VARCHAR(500)  NULL,
  status_changed_by INT           NULL,
  detected_at       TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  last_seen_at      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  resolved_at       TIMESTAMP(3)  NULL,
  updated_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_geo_opportunities_key (natural_key),
  KEY idx_geo_opportunities_status (status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
