-- Multidioma nativo de Elephant Studio (épica E-1; diseño en docs/architecture/studio-multidioma.md). Aditiva, BD de
-- cada empresa. Numeración: 0068 (E-7 = 0066, E-3 = 0067).
--
-- `site_locales`: idiomas de la empresa. Tabla vacia = solo el idioma principal implicito (`es`): comportamiento actual.
--   Un idioma adicional es publico solo cuando `status = 'validated'` (validacion humana, con autor y fecha).
-- `page_translations`: traduccion de una pagina (static_pages.id) a un idioma. Las columnas slug, title, meta_* y
--   draft_blocks son el BORRADOR de trabajo; published_slug, published_meta y published_blocks, lo que se sirve y solo
--   se rellena al VALIDAR (accion humana). Se sirve solo con `status = 'validated'` y el idioma validado.
-- `content_translations`: traducciones genericas de campos de otras entidades (elemento de menu, ajuste global,
--   formulario fuera de pagina, producto de la tienda). Texto plano; el precio y la disponibilidad no se traducen.
--
-- No modifica ninguna tabla existente. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS site_locales (
  locale        VARCHAR(35)  NOT NULL,
  is_default    TINYINT(1)   NOT NULL DEFAULT 0,
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft',
  sort_order    INT          NOT NULL DEFAULT 0,
  validated_at  DATETIME     NULL,
  validated_by  VARCHAR(190) NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (locale)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS page_translations (
  id               INT          NOT NULL AUTO_INCREMENT,
  page_id          INT          NOT NULL,
  locale           VARCHAR(35)  NOT NULL,
  slug             VARCHAR(190) NOT NULL,
  published_slug   VARCHAR(190) NULL,
  published_meta   JSON         NULL,
  title            VARCHAR(256) NOT NULL,
  meta_title       VARCHAR(256) NULL,
  meta_description TEXT         NULL,
  og_image_url     TEXT         NULL,
  draft_blocks     JSON         NULL,
  published_blocks JSON         NULL,
  status           VARCHAR(16)  NOT NULL DEFAULT 'draft',
  base_hash        VARCHAR(32)  NULL,
  validated_at     DATETIME     NULL,
  validated_by     VARCHAR(190) NULL,
  created_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_page_translations_page_locale (page_id, locale),
  UNIQUE KEY uq_page_translations_locale_slug (locale, slug),
  UNIQUE KEY uq_page_translations_locale_pubslug (locale, published_slug),
  KEY idx_page_translations_status (locale, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS content_translations (
  id            INT          NOT NULL AUTO_INCREMENT,
  entity_type   VARCHAR(24)  NOT NULL,
  entity_key    VARCHAR(190) NOT NULL,
  locale        VARCHAR(35)  NOT NULL,
  fields        JSON         NOT NULL,
  slug          VARCHAR(190) NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'draft',
  validated_at  DATETIME     NULL,
  validated_by  VARCHAR(190) NULL,
  created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_content_translations_entity (entity_type, entity_key, locale),
  UNIQUE KEY uq_content_translations_slug (entity_type, locale, slug),
  KEY idx_content_translations_locale (locale, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
