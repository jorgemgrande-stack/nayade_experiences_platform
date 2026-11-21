-- Elephant Learning · editor de formación (lote 1). Aditiva: no toca ninguna tabla existente.
--   learning_course_drafts: UN borrador por curso (documento JSON con títulos, textos y orden). Los alumnos siguen leyendo las
--     tablas vivas hasta que un administrador publica. `base_hash` es la huella de lo publicado cuando se abrió el borrador:
--     si lo publicado cambió desde entonces (p. ej. una importación), publicar se rechaza en lugar de pisarlo.
--   learning_course_versions: estado publicado ANTERIOR a cada publicación (para recuperarlo). Nada se borra.
CREATE TABLE IF NOT EXISTS learning_course_drafts (
  course_id   INT UNSIGNED NOT NULL,
  doc         MEDIUMTEXT NOT NULL,
  base_hash   CHAR(64) NOT NULL,
  created_by  INT NULL,
  created_at  BIGINT NOT NULL,
  updated_by  INT NULL,
  updated_at  BIGINT NOT NULL,
  PRIMARY KEY (course_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS learning_course_versions (
  id          INT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id   INT UNSIGNED NOT NULL,
  version     INT NOT NULL,
  snapshot    MEDIUMTEXT NOT NULL,
  state_hash  CHAR(64) NOT NULL,
  summary     VARCHAR(600) NULL,
  note        VARCHAR(300) NULL,
  created_by  INT NULL,
  created_at  BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_learning_versions (course_id, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
