-- Big Elephant — Hotel Net · núcleo PMS: habitaciones físicas, asignación y restricciones de estancia (aditiva, BD de
-- cada empresa; solo actúa con la capacidad hotel-net).
--
-- `hotel_rooms`: habitaciones físicas de cada tipología (room_types), con su estado operativo (libre, ocupada, sucia,
-- fuera de servicio…). site_id NULL = sede principal. El código es único por sede: site_key (columna generada,
-- '' para la principal) evita que dos habitaciones de la sede principal compartan código, porque en un índice único
-- MySQL no compara los NULL entre sí.
-- `hotel_room_state_events`: historial de cambios de estado operativo (quién, cuándo, de qué estado a cuál y por qué).
-- `hotel_room_assignments`: habitación física asignada a una reserva de hotel (una por reserva: reservation_id único),
-- con las fechas de la estancia copiadas para detectar solapes sin leer la reserva.
-- `hotel_stay_restrictions`: restricciones de estancia por tipología y día (estancia mínima y máxima, cerrado a
-- llegadas o a salidas), único por (tipología, día). Sin fila, o nulas y a 0, no restringen nada. Tabla propia: no
-- altera `room_blocks` (inventario por día), que sigue como siempre.
--
-- Solo crea tablas nuevas. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS hotel_rooms (
  id                  INT           NOT NULL AUTO_INCREMENT,
  site_id             VARCHAR(63)   NULL DEFAULT NULL,
  site_key            VARCHAR(63)   GENERATED ALWAYS AS (IFNULL(site_id, '')) STORED NOT NULL,
  room_type_id        INT           NOT NULL,
  code                VARCHAR(32)   NOT NULL,
  name                VARCHAR(120)  NULL DEFAULT NULL,
  floor               VARCHAR(32)   NULL DEFAULT NULL,
  notes               TEXT          NULL,
  attributes          JSON          NULL,
  is_active           TINYINT(1)    NOT NULL DEFAULT 1,
  operational_status  VARCHAR(32)   NOT NULL DEFAULT 'libre',
  sort_order          INT           NOT NULL DEFAULT 0,
  created_at          BIGINT        NOT NULL,
  updated_at          BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_rooms_site_code (site_key, code),
  KEY idx_hotel_rooms_type (room_type_id, is_active),
  KEY idx_hotel_rooms_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_room_state_events (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  hotel_room_id  INT           NOT NULL,
  from_status    VARCHAR(32)   NULL DEFAULT NULL,
  to_status      VARCHAR(32)   NOT NULL,
  reason         VARCHAR(255)  NULL DEFAULT NULL,
  user_id        INT           NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hotel_room_state_events_room (hotel_room_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_room_assignments (
  id              INT           NOT NULL AUTO_INCREMENT,
  reservation_id  INT           NOT NULL,
  hotel_room_id   INT           NOT NULL,
  check_in        VARCHAR(10)   NOT NULL,
  check_out       VARCHAR(10)   NOT NULL,
  notes           TEXT          NULL,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_room_assignments_reservation (reservation_id),
  KEY idx_hotel_room_assignments_room (hotel_room_id, check_in, check_out)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_stay_restrictions (
  id                   INT         NOT NULL AUTO_INCREMENT,
  room_type_id         INT         NOT NULL,
  date                 VARCHAR(10) NOT NULL,
  min_stay             INT         NULL DEFAULT NULL,
  max_stay             INT         NULL DEFAULT NULL,
  closed_to_arrival    TINYINT(1)  NOT NULL DEFAULT 0,
  closed_to_departure  TINYINT(1)  NOT NULL DEFAULT 0,
  created_by           INT         NULL DEFAULT NULL,
  updated_at           BIGINT      NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_stay_restrictions_type_date (room_type_id, date),
  KEY idx_hotel_stay_restrictions_date (date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
