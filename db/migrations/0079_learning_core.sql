-- Elephant LMS (formación digital de pago con acceso privado por alumno). Aditiva, BD de cada empresa.
--
-- Contenido:  learning_courses → learning_modules → learning_lessons → learning_blocks (→ learning_resources).
--   Los títulos originales y la URL de origen se conservan para trazabilidad; `source_key` hace idempotente la importación
--   (reimportar no duplica). Un recurso sin fichero queda `pending` (nunca un marcador presentado como contenido real).
-- Acceso:     learning_enrollments (matrícula nominativa: usuario, curso, ventana de fechas, estado, origen y prueba del
--   pago o de la concesión), learning_enrollment_modules (qué módulos abre), learning_access_events (historial inmutable),
--   learning_access_rules (reglas de catálogo: producto/variante → curso, módulos y duración).
-- Progreso:   learning_progress (por usuario y lección; sobrevive a la caducidad de la matrícula).
--
-- Una matrícula solo nace con `idempotency_key` única: un webhook repetido o dos procesos a la vez no duplican.
-- Sin claves foráneas (como el resto de este carril). Solo crea tablas. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS learning_courses (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(120) NOT NULL,
  title         VARCHAR(300) NOT NULL,
  description   TEXT NULL,
  language      VARCHAR(8)   NOT NULL DEFAULT 'de',
  status        ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  source_note   VARCHAR(600) NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_courses_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_modules (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id     INT UNSIGNED NOT NULL,
  position      INT NOT NULL,
  title         VARCHAR(300) NOT NULL,
  original_title VARCHAR(300) NULL,
  source_url    VARCHAR(600) NULL,
  source_key    VARCHAR(190) NOT NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_modules_key (course_id, source_key),
  KEY idx_learning_modules_course (course_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_lessons (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  module_id     INT UNSIGNED NOT NULL,
  position      INT NOT NULL,
  title         VARCHAR(300) NOT NULL,
  original_title VARCHAR(300) NULL,
  source_url    VARCHAR(600) NULL,
  source_key    VARCHAR(190) NOT NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_lessons_key (module_id, source_key),
  KEY idx_learning_lessons_module (module_id, position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_resources (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  kind          ENUM('video','audio','pdf','document','image') NOT NULL,
  original_name VARCHAR(300) NULL,
  mime_type     VARCHAR(120) NULL,
  size_bytes    BIGINT NULL,
  sha256        CHAR(64) NULL,
  stored_object_id INT NULL,
  status        ENUM('pending','verified','rejected') NOT NULL DEFAULT 'pending',
  provenance    VARCHAR(600) NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_learning_resources_hash (sha256),
  KEY idx_learning_resources_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_blocks (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  lesson_id     INT UNSIGNED NOT NULL,
  position      INT NOT NULL,
  kind          ENUM('text','video','audio','pdf','exercise','external_link') NOT NULL,
  title         VARCHAR(300) NOT NULL,
  original_title VARCHAR(300) NULL,
  body          MEDIUMTEXT NULL,
  resource_id   INT UNSIGNED NULL,
  external_url  VARCHAR(600) NULL,
  duration_seconds INT NULL,
  activity      VARCHAR(40) NULL,
  attribution   VARCHAR(300) NULL,
  source_key    VARCHAR(190) NOT NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_blocks_key (lesson_id, source_key),
  KEY idx_learning_blocks_lesson (lesson_id, position),
  KEY idx_learning_blocks_resource (resource_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_enrollments (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id       INT NOT NULL,
  client_id     INT NULL,
  course_id     INT UNSIGNED NOT NULL,
  status        ENUM('active','suspended','revoked','expired') NOT NULL DEFAULT 'active',
  source        ENUM('payment','admin','demo') NOT NULL,
  starts_at     BIGINT NOT NULL,
  ends_at       BIGINT NULL,
  experience_id INT NULL,
  variant_id    INT NULL,
  enrollment_id INT NULL,
  order_id      INT NULL,
  quote_id      INT NULL,
  payment_ref   VARCHAR(190) NULL,
  payment_amount_cents INT NULL,
  grant_reason  VARCHAR(500) NULL,
  granted_by    INT NULL,
  idempotency_key VARCHAR(190) NOT NULL,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_enrollments_key (idempotency_key),
  KEY idx_learning_enrollments_user (user_id, status),
  KEY idx_learning_enrollments_course (course_id, status),
  KEY idx_learning_enrollments_ends (status, ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_enrollment_modules (
  enrollment_id INT UNSIGNED NOT NULL,
  module_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (enrollment_id, module_id),
  KEY idx_learning_enrollment_modules_module (module_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_access_events (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  enrollment_id INT UNSIGNED NOT NULL,
  type          VARCHAR(40) NOT NULL,
  actor_user_id INT NULL,
  detail        JSON NULL,
  created_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_learning_access_events_enrollment (enrollment_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_access_rules (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  experience_id INT NOT NULL,
  variant_id    INT NULL,
  course_id     INT UNSIGNED NOT NULL,
  duration_days INT NULL,
  start_mode    ENUM('on_grant','fixed_date') NOT NULL DEFAULT 'on_grant',
  fixed_start   BIGINT NULL,
  active        TINYINT(1) NOT NULL DEFAULT 0,
  created_at    BIGINT NOT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY idx_learning_access_rules_product (experience_id, variant_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_access_rule_modules (
  rule_id       INT UNSIGNED NOT NULL,
  module_id     INT UNSIGNED NOT NULL,
  PRIMARY KEY (rule_id, module_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_progress (
  user_id       INT NOT NULL,
  lesson_id     INT UNSIGNED NOT NULL,
  status        ENUM('in_progress','completed') NOT NULL DEFAULT 'in_progress',
  last_block_id INT UNSIGNED NULL,
  completed_at  BIGINT NULL,
  updated_at    BIGINT NOT NULL,
  PRIMARY KEY (user_id, lesson_id),
  KEY idx_learning_progress_user (user_id, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
