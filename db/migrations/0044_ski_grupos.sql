-- Ski Net · Cursillos y grupos por niveles (server/skiSchool/grouping*.ts): bolsa de inscripción de un turno de un
-- producto colectivo (producto, día y hora) con los alumnos aún sin grupo. La propuesta de agrupación no se guarda: se
-- recalcula y se aplica solo si coincide con la revisada (huella). Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS ski_school_enrollment_pool (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)  NOT NULL,
  product_id     INT UNSIGNED NOT NULL,
  session_date   DATE         NOT NULL,
  start_time     CHAR(5)      NOT NULL,
  full_name      VARCHAR(120) NOT NULL,
  age            TINYINT UNSIGNED NULL,
  level          VARCHAR(16)  NULL,
  language       VARCHAR(16)  NULL,
  notes          VARCHAR(500) NULL,
  status         VARCHAR(16)  NOT NULL DEFAULT 'pending',
  session_id     INT UNSIGNED NULL,
  participant_id INT UNSIGNED NULL,
  created_by     VARCHAR(100) NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  placed_at      TIMESTAMP(3) NULL,
  PRIMARY KEY (id),
  KEY idx_ski_school_pool_turn (site_id, product_id, session_date, start_time, status),
  CONSTRAINT fk_ski_school_pool_product FOREIGN KEY (product_id) REFERENCES ski_school_products (id),
  CONSTRAINT fk_ski_school_pool_session FOREIGN KEY (session_id) REFERENCES ski_school_sessions (id),
  CONSTRAINT chk_ski_school_pool_status CHECK (status IN ('pending', 'placed', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
