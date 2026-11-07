-- Big Elephant — Travel Net: expedientes de viaje con servicios de varios proveedores, márgenes comerciales y
-- operaciones con cada proveedor (aditiva, BD de cada empresa; solo actúa con la capacidad travel-net).
--
-- Los proveedores son los del Core (`suppliers`): aquí solo se guarda su perfil turístico y sus contactos operativos.
-- El presupuesto es el del Core (`leads` + `quotes`) y la reserva, la del Core (`reservations`): el expediente los enlaza.
--
-- `travel_files`: expediente (paquete o viaje) de un cliente, por sede (site_id NULL = principal), con su régimen
-- fiscal (REAV o general) y los enlaces al presupuesto y a la reserva del Core.
-- `travel_file_services`: servicios del expediente (alojamiento, actividad, transporte, seguro…), de inventario propio
-- o de un proveedor, con coste neto, PVP y la regla de margen aplicada.
-- `travel_margin_rules`: recargo sobre neto y comisión por defecto por ámbito (global, sede o proveedor; el más
-- concreto gana), únicos por (ámbito, clave).
-- `travel_supplier_profiles`: perfil turístico de un proveedor del Core (modo de conexión, tipos de servicio, correo y
-- teléfono operativos).
-- `travel_supplier_contacts`: contactos operativos del proveedor.
-- `travel_operations`: operación con el proveedor por cada servicio reservado (una por servicio), con su estado y
-- localizador; `travel_operation_status_log`: historial de estados; `travel_audit_log`: auditoría de cambios.
--
-- Solo crea tablas nuevas y vacías. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS travel_files (
  id              INT           NOT NULL AUTO_INCREMENT,
  file_number     VARCHAR(32)   NULL DEFAULT NULL,
  site_id         VARCHAR(63)   NULL DEFAULT NULL,
  title           VARCHAR(200)  NOT NULL,
  status          VARCHAR(16)   NOT NULL DEFAULT 'borrador',
  client_name     VARCHAR(200)  NOT NULL,
  client_email    VARCHAR(320)  NULL DEFAULT NULL,
  client_phone    VARCHAR(50)   NULL DEFAULT NULL,
  start_date      VARCHAR(10)   NULL DEFAULT NULL,
  end_date        VARCHAR(10)   NULL DEFAULT NULL,
  adults          INT           NOT NULL DEFAULT 1,
  children        INT           NOT NULL DEFAULT 0,
  fiscal_regime   VARCHAR(8)    NOT NULL DEFAULT 'reav',
  tax_rate_bp     INT           NOT NULL DEFAULT 2100,
  lead_id         INT           NULL DEFAULT NULL,
  quote_id        INT           NULL DEFAULT NULL,
  reservation_id  INT           NULL DEFAULT NULL,
  notes           TEXT          NULL,
  created_by      INT           NULL DEFAULT NULL,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_travel_files_number (file_number),
  KEY idx_travel_files_status (status, start_date),
  KEY idx_travel_files_quote (quote_id),
  KEY idx_travel_files_site (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_file_services (
  id              INT           NOT NULL AUTO_INCREMENT,
  file_id         INT           NOT NULL,
  kind            VARCHAR(16)   NOT NULL DEFAULT 'otro',
  source          VARCHAR(12)   NOT NULL DEFAULT 'proveedor',
  supplier_id     INT           NULL DEFAULT NULL,
  title           VARCHAR(200)  NOT NULL,
  description     VARCHAR(1000) NULL DEFAULT NULL,
  service_date    VARCHAR(10)   NULL DEFAULT NULL,
  end_date        VARCHAR(10)   NULL DEFAULT NULL,
  quantity        INT           NOT NULL DEFAULT 1,
  pricing_mode    VARCHAR(12)   NOT NULL DEFAULT 'neto',
  net_cents       INT           NOT NULL DEFAULT 0,
  selling_cents   INT           NOT NULL DEFAULT 0,
  markup_bp       INT           NULL DEFAULT NULL,
  commission_bp   INT           NULL DEFAULT NULL,
  rule_source     VARCHAR(12)   NULL DEFAULT NULL,
  sort_order      INT           NOT NULL DEFAULT 0,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_travel_file_services_file (file_id, sort_order),
  KEY idx_travel_file_services_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_margin_rules (
  id             INT           NOT NULL AUTO_INCREMENT,
  scope          VARCHAR(10)   NOT NULL,
  scope_key      VARCHAR(63)   NOT NULL DEFAULT '',
  markup_bp      INT           NOT NULL DEFAULT 2000,
  commission_bp  INT           NOT NULL DEFAULT 0,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  updated_by     INT           NULL DEFAULT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_travel_margin_rules_scope (scope, scope_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_supplier_profiles (
  supplier_id        INT           NOT NULL,
  connection_mode    VARCHAR(8)    NOT NULL DEFAULT 'manual',
  service_kinds      JSON          NULL,
  operational_email  VARCHAR(320)  NULL DEFAULT NULL,
  operational_phone  VARCHAR(50)   NULL DEFAULT NULL,
  notes              TEXT          NULL,
  is_active          TINYINT(1)    NOT NULL DEFAULT 1,
  updated_at         BIGINT        NOT NULL,
  PRIMARY KEY (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_supplier_contacts (
  id           INT           NOT NULL AUTO_INCREMENT,
  supplier_id  INT           NOT NULL,
  name         VARCHAR(200)  NOT NULL,
  role         VARCHAR(100)  NULL DEFAULT NULL,
  email        VARCHAR(320)  NULL DEFAULT NULL,
  phone        VARCHAR(50)   NULL DEFAULT NULL,
  is_primary   TINYINT(1)    NOT NULL DEFAULT 0,
  created_at   BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_travel_supplier_contacts_supplier (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_operations (
  id                INT           NOT NULL AUTO_INCREMENT,
  file_id           INT           NOT NULL,
  service_id        INT           NOT NULL,
  reservation_id    INT           NULL DEFAULT NULL,
  supplier_id       INT           NULL DEFAULT NULL,
  status            VARCHAR(32)   NOT NULL DEFAULT 'pending_submission',
  provider_locator  VARCHAR(128)  NULL DEFAULT NULL,
  sla_deadline_at   BIGINT        NULL DEFAULT NULL,
  submitted_at      BIGINT        NULL DEFAULT NULL,
  confirmed_at      BIGINT        NULL DEFAULT NULL,
  consolidated_at   BIGINT        NULL DEFAULT NULL,
  internal_notes    TEXT          NULL,
  created_at        BIGINT        NOT NULL,
  updated_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_travel_operations_service (service_id),
  KEY idx_travel_operations_status (status),
  KEY idx_travel_operations_file (file_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_operation_status_log (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  operation_id   INT           NOT NULL,
  from_status    VARCHAR(32)   NULL DEFAULT NULL,
  to_status      VARCHAR(32)   NOT NULL,
  actor_user_id  INT           NULL DEFAULT NULL,
  reason         VARCHAR(500)  NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_travel_operation_status_log_op (operation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_audit_log (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  entity_type    VARCHAR(32)   NOT NULL,
  entity_id      INT           NOT NULL,
  action         VARCHAR(48)   NOT NULL,
  actor_user_id  INT           NULL DEFAULT NULL,
  details_json   JSON          NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_travel_audit_log_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
