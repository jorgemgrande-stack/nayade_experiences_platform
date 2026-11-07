-- Big Elephant — Hotel Net · housekeeping: tareas de limpieza por habitación y día e incidencias de habitación
-- (aditiva, BD de cada empresa; solo actúa con la capacidad hotel-net). Depende de 0032_hotel_pms.
--
-- `hotel_housekeeping_tasks`: una tarea por habitación y día (único): limpieza de salida, repaso de habitación ocupada
-- o limpieza a petición, asignada a un USUARIO del panel de la empresa (users.id), con su estado (pendiente, en curso,
-- hecha, inspeccionada) y quién y cuándo la hizo e inspeccionó. Al cambiar de estado se actualiza el estado operativo de
-- la habitación con su historial (hotel_room_state_events).
-- `hotel_incident_types`: tipos de incidencia de la empresa (configurables; la primera vez se crean unos por defecto).
-- `hotel_room_incidents`: incidencias de una habitación (tipo, prioridad, estado, si bloquea la habitación, quién la
-- abrió y quién la resolvió).
--
-- Solo crea tablas nuevas y vacías. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS hotel_housekeeping_tasks (
  id                INT           NOT NULL AUTO_INCREMENT,
  hotel_room_id     INT           NOT NULL,
  task_date         VARCHAR(10)   NOT NULL,
  kind              VARCHAR(16)   NOT NULL DEFAULT 'salida',
  status            VARCHAR(16)   NOT NULL DEFAULT 'pendiente',
  assigned_user_id  INT           NULL DEFAULT NULL,
  notes             VARCHAR(500)  NULL DEFAULT NULL,
  started_at        BIGINT        NULL DEFAULT NULL,
  done_at           BIGINT        NULL DEFAULT NULL,
  done_by           INT           NULL DEFAULT NULL,
  inspected_at      BIGINT        NULL DEFAULT NULL,
  inspected_by      INT           NULL DEFAULT NULL,
  created_by        INT           NULL DEFAULT NULL,
  created_at        BIGINT        NOT NULL,
  updated_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_hk_tasks_room_date (hotel_room_id, task_date),
  KEY idx_hotel_hk_tasks_date (task_date, status),
  KEY idx_hotel_hk_tasks_user (assigned_user_id, task_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_incident_types (
  id          INT           NOT NULL AUTO_INCREMENT,
  name        VARCHAR(80)   NOT NULL,
  is_active   TINYINT(1)    NOT NULL DEFAULT 1,
  sort_order  INT           NOT NULL DEFAULT 0,
  created_at  BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_incident_types_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_room_incidents (
  id             INT           NOT NULL AUTO_INCREMENT,
  hotel_room_id  INT           NOT NULL,
  type_id        INT           NOT NULL,
  description    VARCHAR(1000) NULL DEFAULT NULL,
  priority       VARCHAR(8)    NOT NULL DEFAULT 'media',
  status         VARCHAR(12)   NOT NULL DEFAULT 'abierta',
  blocks_room    TINYINT(1)    NOT NULL DEFAULT 0,
  reported_by    INT           NULL DEFAULT NULL,
  resolved_by    INT           NULL DEFAULT NULL,
  resolved_at    BIGINT        NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hotel_room_incidents_room (hotel_room_id, status),
  KEY idx_hotel_room_incidents_status (status, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
