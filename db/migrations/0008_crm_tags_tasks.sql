-- CRM: etiquetas (crm-tags) y tareas internas (crm-tasks). Aditiva: solo crea tablas nuevas; no toca
-- datos existentes. Cada empresa tiene su propia base de datos, así que no hay columna de empresa.
--  - crm_tags: catálogo de etiquetas (nombre único sin distinguir mayúsculas ni acentos, color opcional).
--  - crm_tag_links: etiqueta asignada a un cliente o a una oportunidad (lead). Al borrar la etiqueta
--    se borran sus asignaciones (ON DELETE CASCADE).
--  - crm_tasks: tareas con vencimiento, responsable, estado, prioridad y vínculo opcional a cliente,
--    oportunidad o presupuesto.
CREATE TABLE IF NOT EXISTS crm_tags (
  id          INT          NOT NULL AUTO_INCREMENT,
  name        VARCHAR(60)  NOT NULL,
  color       VARCHAR(20)  NULL,
  created_by  INT          NULL,
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_tags_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS crm_tag_links (
  id           INT          NOT NULL AUTO_INCREMENT,
  tag_id       INT          NOT NULL,
  entity_type  VARCHAR(16)  NOT NULL,
  entity_id    INT          NOT NULL,
  created_by   INT          NULL,
  created_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_tag_links (tag_id, entity_type, entity_id),
  KEY idx_crm_tag_links_entity (entity_type, entity_id),
  CONSTRAINT fk_crm_tag_links_tag FOREIGN KEY (tag_id) REFERENCES crm_tags (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE IF NOT EXISTS crm_tasks (
  id            INT                            NOT NULL AUTO_INCREMENT,
  title         VARCHAR(200)                   NOT NULL,
  description   TEXT                           NULL,
  due_date      DATE                           NULL,
  assigned_to   INT                            NULL,
  status        ENUM('pendiente','hecha')      NOT NULL DEFAULT 'pendiente',
  priority      ENUM('baja','media','alta')    NOT NULL DEFAULT 'media',
  entity_type   VARCHAR(16)                    NULL,
  entity_id     INT                            NULL,
  created_by    INT                            NULL,
  completed_at  TIMESTAMP                      NULL DEFAULT NULL,
  completed_by  INT                            NULL,
  created_at    TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP                      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_crm_tasks_assignee (assigned_to, status, due_date),
  KEY idx_crm_tasks_status_due (status, due_date),
  KEY idx_crm_tasks_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
