-- Big Elephant — Hotel Net · ficha de huésped (registro de viajeros, RD 933/2021) y planes de tarifa por tipología
-- (aditiva, BD de cada empresa; solo actúa con la capacidad hotel-net). Depende de 0032_hotel_pms.
--
-- `hotel_guests`: ficha de cada persona alojada (datos de identidad, documento, nacionalidad, nacimiento y dirección),
-- vinculada al cliente del CRM (`clients.id`) cuando existe. doc_key (columna generada) hace único el documento
-- (tipo + número) sin impedir fichas sin documento. anonymized_at marca las fichas cuyos datos personales se borraron
-- por la política de conservación.
-- `hotel_stay_guests`: huéspedes de cada reserva (titular y acompañantes): el historial de estancias de cada huésped.
-- `hotel_guest_settings`: conservación de las fichas (una fila, id = 1). Sin fila o con retention_months NULL no se
-- anonimiza nada.
-- `hotel_rate_plans`: planes de tarifa por tipología (BAR, no reembolsable, con desayuno…): ajuste en % o importe fijo
-- por noche sobre el precio de la noche. Sin planes, el precio es el de siempre.
--
-- Solo crea tablas nuevas y vacías. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS hotel_guests (
  id                  INT           NOT NULL AUTO_INCREMENT,
  client_id           INT           NULL DEFAULT NULL,
  first_name          VARCHAR(120)  NULL DEFAULT NULL,
  last_name           VARCHAR(160)  NULL DEFAULT NULL,
  second_last_name    VARCHAR(160)  NULL DEFAULT NULL,
  sex                 VARCHAR(16)   NULL DEFAULT NULL,
  birth_date          VARCHAR(10)   NULL DEFAULT NULL,
  nationality         VARCHAR(80)   NULL DEFAULT NULL,
  doc_type            VARCHAR(16)   NULL DEFAULT NULL,
  doc_number          VARCHAR(64)   NULL DEFAULT NULL,
  doc_support_number  VARCHAR(64)   NULL DEFAULT NULL,
  doc_issue_date      VARCHAR(10)   NULL DEFAULT NULL,
  doc_key             VARCHAR(90)   GENERATED ALWAYS AS (IF(doc_number IS NULL OR doc_number = '', NULL, CONCAT(IFNULL(doc_type, ''), '|', UPPER(doc_number)))) STORED,
  address             VARCHAR(255)  NULL DEFAULT NULL,
  city                VARCHAR(120)  NULL DEFAULT NULL,
  postal_code         VARCHAR(16)   NULL DEFAULT NULL,
  country             VARCHAR(80)   NULL DEFAULT NULL,
  phone               VARCHAR(40)   NULL DEFAULT NULL,
  email               VARCHAR(255)  NULL DEFAULT NULL,
  notes               VARCHAR(1000) NULL DEFAULT NULL,
  last_stay_at        VARCHAR(10)   NULL DEFAULT NULL,
  anonymized_at       BIGINT        NULL DEFAULT NULL,
  created_by          INT           NULL DEFAULT NULL,
  created_at          BIGINT        NOT NULL,
  updated_at          BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_guests_doc (doc_key),
  KEY idx_hotel_guests_client (client_id),
  KEY idx_hotel_guests_name (last_name, first_name),
  KEY idx_hotel_guests_last_stay (last_stay_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_stay_guests (
  id              INT           NOT NULL AUTO_INCREMENT,
  reservation_id  INT           NOT NULL,
  guest_id        INT           NOT NULL,
  is_lead         TINYINT(1)    NOT NULL DEFAULT 0,
  kinship         VARCHAR(40)   NULL DEFAULT NULL,
  check_in        VARCHAR(10)   NOT NULL,
  check_out       VARCHAR(10)   NOT NULL,
  created_by      INT           NULL DEFAULT NULL,
  created_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_stay_guests (reservation_id, guest_id),
  KEY idx_hotel_stay_guests_guest (guest_id, check_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_guest_settings (
  id                TINYINT   NOT NULL,
  retention_months  INT       NULL DEFAULT NULL,
  updated_by        INT       NULL DEFAULT NULL,
  updated_at        BIGINT    NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_rate_plans (
  id                  INT           NOT NULL AUTO_INCREMENT,
  room_type_id        INT           NOT NULL,
  code                VARCHAR(32)   NULL DEFAULT NULL,
  name                VARCHAR(120)  NOT NULL,
  description         VARCHAR(255)  NULL DEFAULT NULL,
  refundable          TINYINT(1)    NOT NULL DEFAULT 1,
  includes_breakfast  TINYINT(1)    NOT NULL DEFAULT 0,
  adjust_type         VARCHAR(8)    NOT NULL DEFAULT 'none',
  adjust_value        INT           NOT NULL DEFAULT 0,
  sort_order          INT           NOT NULL DEFAULT 0,
  is_active           TINYINT(1)    NOT NULL DEFAULT 1,
  created_at          BIGINT        NOT NULL,
  updated_at          BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hotel_rate_plans_type (room_type_id, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
