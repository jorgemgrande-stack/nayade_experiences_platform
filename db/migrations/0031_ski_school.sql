-- Ski Net · Escuela (módulo del SDK, server/skiSchool): activación y configuración por sede, profesores, ausencias,
-- productos docentes, sesiones y alumnos. Aditiva y reversible: solo crea tablas nuevas. Desactivar la escuela no
-- borra nada (ski_school_sites.active = 0); profesores y productos se archivan, ausencias y alumnos se anulan.
CREATE TABLE IF NOT EXISTS ski_school_sites (
  site_id        VARCHAR(63)  NOT NULL,
  active         TINYINT(1)   NOT NULL DEFAULT 0,
  config         JSON         NULL,
  activated_at   TIMESTAMP(3) NULL,
  deactivated_at TIMESTAMP(3) NULL,
  updated_by     VARCHAR(100) NULL,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_instructors (
  id                  INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id             VARCHAR(63)  NOT NULL,
  full_name           VARCHAR(120) NOT NULL,
  email               VARCHAR(200) NULL,
  phone               VARCHAR(30)  NULL,
  modalities          JSON         NOT NULL,
  levels              JSON         NOT NULL,
  languages           JSON         NOT NULL,
  min_age             TINYINT UNSIGNED NULL,
  max_age             TINYINT UNSIGNED NULL,
  weekly_availability JSON         NOT NULL,
  notes               TEXT         NULL,
  active              TINYINT(1)   NOT NULL DEFAULT 1,
  created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ski_school_instructors_site (site_id, active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_absences (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       VARCHAR(63)  NOT NULL,
  instructor_id INT UNSIGNED NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL,
  kind          VARCHAR(16)  NOT NULL DEFAULT 'day_off',
  start_time    CHAR(5)      NULL,
  end_time      CHAR(5)      NULL,
  reason        VARCHAR(200) NULL,
  created_by    VARCHAR(100) NULL,
  cancelled_at  TIMESTAMP(3) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ski_school_absences_site_dates (site_id, start_date, end_date),
  KEY idx_ski_school_absences_instructor (instructor_id, start_date, end_date),
  CONSTRAINT fk_ski_school_absences_instructor FOREIGN KEY (instructor_id) REFERENCES ski_school_instructors (id),
  CONSTRAINT chk_ski_school_absences_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_ski_school_absences_kind CHECK (kind IN ('day_off', 'partial_block'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_products (
  id               INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id          VARCHAR(63)  NOT NULL,
  name             VARCHAR(120) NOT NULL,
  kind             VARCHAR(16)  NOT NULL,
  duration_minutes SMALLINT UNSIGNED NOT NULL,
  capacity         SMALLINT UNSIGNED NOT NULL,
  level            VARCHAR(16)  NULL,
  modality         VARCHAR(16)  NULL,
  min_age          TINYINT UNSIGNED NULL,
  max_age          TINYINT UNSIGNED NULL,
  active           TINYINT(1)   NOT NULL DEFAULT 1,
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_school_products_site_name (site_id, name),
  CONSTRAINT chk_ski_school_products_kind CHECK (kind IN ('private', 'group', 'kids')),
  CONSTRAINT chk_ski_school_products_capacity CHECK (capacity > 0)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_sessions (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)  NOT NULL,
  product_id     INT UNSIGNED NOT NULL,
  session_date   DATE         NOT NULL,
  start_time     CHAR(5)      NOT NULL,
  end_time       CHAR(5)      NOT NULL,
  modality       VARCHAR(16)  NULL,
  level          VARCHAR(16)  NULL,
  language       VARCHAR(16)  NULL,
  capacity       SMALLINT UNSIGNED NOT NULL,
  instructor_id  INT UNSIGNED NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  reservation_id INT          NULL,
  meeting_point  VARCHAR(120) NULL,
  notes          TEXT         NULL,
  created_by     VARCHAR(100) NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ski_school_sessions_site_date (site_id, session_date, start_time),
  KEY idx_ski_school_sessions_instructor_date (instructor_id, session_date),
  KEY idx_ski_school_sessions_site_reservation (site_id, reservation_id),
  CONSTRAINT fk_ski_school_sessions_product FOREIGN KEY (product_id) REFERENCES ski_school_products (id),
  CONSTRAINT fk_ski_school_sessions_instructor FOREIGN KEY (instructor_id) REFERENCES ski_school_instructors (id),
  CONSTRAINT chk_ski_school_sessions_times CHECK (end_time > start_time),
  CONSTRAINT chk_ski_school_sessions_capacity CHECK (capacity > 0),
  CONSTRAINT chk_ski_school_sessions_status CHECK (status IN ('pending', 'assigned', 'completed', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_school_participants (
  id           INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id      VARCHAR(63)  NOT NULL,
  session_id   INT UNSIGNED NOT NULL,
  full_name    VARCHAR(120) NOT NULL,
  age          TINYINT UNSIGNED NULL,
  level        VARCHAR(16)  NULL,
  notes        VARCHAR(500) NULL,
  status       VARCHAR(16)  NOT NULL DEFAULT 'enrolled',
  cancelled_at TIMESTAMP(3) NULL,
  created_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ski_school_participants_session (session_id, status),
  KEY idx_ski_school_participants_site (site_id, status),
  CONSTRAINT fk_ski_school_participants_session FOREIGN KEY (session_id) REFERENCES ski_school_sessions (id),
  CONSTRAINT chk_ski_school_participants_status CHECK (status IN ('enrolled', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
