-- Redirecciones permanentes (301/302) de la web pública por empresa. Aditiva, BD de cada empresa.
--
-- `site_redirects`: ruta antigua (única) → ruta nueva INTERNA, con contador de usos y estado. Solo rutas de la propia web:
-- no hay redirecciones a otros dominios. `site_redirect_log`: auditoría de cada alta, cambio y baja (quién, cuándo, qué).
-- Solo crea tablas; los sitios sin reglas se comportan exactamente igual. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS site_redirects (
  id           INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  from_path    VARCHAR(255)  NOT NULL,
  to_path      VARCHAR(512)  NOT NULL,
  status_code  SMALLINT      NOT NULL DEFAULT 301,
  is_active    TINYINT(1)    NOT NULL DEFAULT 1,
  note         VARCHAR(255)  NULL,
  hits         INT UNSIGNED  NOT NULL DEFAULT 0,
  last_hit_at  DATETIME      NULL,
  created_by   VARCHAR(128)  NULL,
  created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_site_redirects_from (from_path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS site_redirect_log (
  id            INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  redirect_id   INT UNSIGNED  NULL,
  action        VARCHAR(16)   NOT NULL,
  from_path     VARCHAR(255)  NOT NULL,
  to_path       VARCHAR(512)  NULL,
  status_code   SMALLINT      NULL,
  actor_id      INT           NULL,
  actor_name    VARCHAR(128)  NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_site_redirect_log_redirect (redirect_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
