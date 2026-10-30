-- Big Elephant — Solicitudes de derechos de protección de datos (RGPD) de clientes o contactos (aditiva, base del CRM).
--
-- `data_requests`: una fila por solicitud de acceso, exportación (portabilidad), supresión, rectificación u oposición,
-- registrada desde el CRM por el canal por el que llegó. Guarda la fecha de recepción y el plazo legal de respuesta
-- (30 días), el estado (recibida, en curso, resuelta, rechazada), el responsable asignado (operador: identificador y
-- nombre visible) y cómo se resolvió. Solo el nombre y el correo de quien la presenta: sin documentos de identidad.
-- Al registrarse, y si se acerca o vence el plazo sin resolver, sale la alerta administrativa `admin.data_request`.
-- Sin estas tablas el plano de control funciona igual: la función no se monta.
--
-- `data_request_events`: historial de cada solicitud (creada, estado cambiado, responsable asignado, nota añadida,
-- resuelta, escalada) con el momento, quién lo hizo y el detalle. Solo se añaden filas: nunca se editan.
--
-- irreversible: acredita que cada solicitud de derechos se atendió en plazo (obligación de responsabilidad proactiva del RGPD); el código anterior ignora estas tablas, así que no hace falta borrarlas para volver atrás.

CREATE TABLE data_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference VARCHAR(32) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  channel VARCHAR(16) NOT NULL,
  requester_name VARCHAR(160) NOT NULL,
  requester_email VARCHAR(254) NOT NULL,
  company_id BIGINT UNSIGNED NULL,
  tenant_id VARCHAR(64) NULL,
  details VARCHAR(2000) NULL,
  received_at BIGINT NOT NULL,
  due_at BIGINT NOT NULL,
  assignee_id VARCHAR(100) NULL,
  assignee_name VARCHAR(160) NULL,
  resolved_at BIGINT NULL,
  resolution VARCHAR(2000) NULL,
  created_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_data_request_reference (reference),
  KEY ix_data_request_open (status, due_at),
  KEY ix_data_request_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE data_request_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  request_id BIGINT UNSIGNED NOT NULL,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  type VARCHAR(24) NOT NULL,
  detail VARCHAR(2000) NULL,
  PRIMARY KEY (id),
  KEY ix_data_request_event_request (request_id, id),
  CONSTRAINT fk_data_request_event FOREIGN KEY (request_id) REFERENCES data_requests (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
