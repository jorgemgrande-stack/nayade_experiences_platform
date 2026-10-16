-- Blog de la web de cada empresa (capacidad `cms-blog`). Aditiva y reversible: solo crea una tabla
-- nueva. `status` es draft|published; una entrada publicada con `published_at` (ms epoch) futura está
-- programada y no se sirve hasta esa fecha. El contenido es HTML que se sanea al servirlo.
CREATE TABLE IF NOT EXISTS blog_posts (
  id                 INT          NOT NULL AUTO_INCREMENT,
  slug               VARCHAR(160) NOT NULL,
  title              VARCHAR(200) NOT NULL,
  excerpt            VARCHAR(500) NULL,
  content            MEDIUMTEXT   NULL,
  featured_image_url VARCHAR(1024) NULL,
  featured_image_alt VARCHAR(200) NULL,
  author_name        VARCHAR(120) NULL,
  author_user_id     INT          NULL,
  category           VARCHAR(80)  NULL,
  status             VARCHAR(16)  NOT NULL DEFAULT 'draft',
  published_at       BIGINT       NULL,
  meta_title         VARCHAR(200) NULL,
  meta_description   VARCHAR(320) NULL,
  created_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_blog_posts_slug (slug),
  KEY idx_blog_posts_public (status, published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
