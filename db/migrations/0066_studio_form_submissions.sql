-- Elephant Studio, formularios seguros (E-7). Aditiva, BD de cada empresa.
--
-- `studio_form_submissions`: constancia de cada envío de un formulario a medida de la web, ligada a su oportunidad
--   (`lead_id`, sin clave foránea: la oportunidad es de la tabla `leads` de siempre y no se toca). Guarda el
--   consentimiento RGPD tal como lo vio la persona (texto exacto de la casilla, su versión y la fecha/hora), el formulario
--   y la página de origen, las UTM y una HUELLA de la IP (HMAC; nunca la dirección). `is_duplicate = 1`: envío repetido del
--   mismo correo y formulario en la ventana corta, anotado en la oportunidad existente en vez de crear otra.
--
-- Solo crea una tabla. Nunca se ejecuta al arrancar. El código funciona igual sin ella (sin constancia ni duplicados).

CREATE TABLE IF NOT EXISTS studio_form_submissions (
  id               INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  lead_id          INT           NOT NULL,
  form_slug        VARCHAR(64)   NOT NULL,
  block_id         VARCHAR(40)   NOT NULL,
  form_title       VARCHAR(200)  NOT NULL DEFAULT '',
  email            VARCHAR(320)  NOT NULL,
  consent_given    TINYINT(1)    NOT NULL DEFAULT 0,
  consent_text     VARCHAR(400)  NULL,
  consent_version  VARCHAR(16)   NULL,
  consent_at       BIGINT        NULL,
  ip_hash          CHAR(64)      NULL,
  page             VARCHAR(200)  NOT NULL DEFAULT '',
  utm_json         TEXT          NULL,
  is_duplicate     TINYINT(1)    NOT NULL DEFAULT 0,
  created_at       BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_studio_form_sub_lead (lead_id),
  KEY idx_studio_form_sub_dedupe (email(120), form_slug, block_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
