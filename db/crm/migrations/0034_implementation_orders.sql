-- Big Elephant — Implantación asistida: expediente y orden de implantación de una solución que necesita preparación
-- técnica antes de habilitarse (aditiva, base del CRM).
--
-- `implementation_orders`: una fila por solución solicitada por una empresa. Cuelga de la oportunidad (y de la
-- solicitud de la web, si llegó por ahí) y del contrato que el cliente acepta. Guarda el responsable o la cola, las
-- condiciones y el plazo ESCRITOS POR UNA PERSONA (nunca calculados), la modalidad de arranque pactada (prueba o
-- suscripción) y cada paso del circuito: aceptación, preparada técnicamente, habilitada, comunicada al cliente e
-- iniciada (la prueba de 15 días cuenta desde que se comunica la disponibilidad). Como mucho un expediente abierto por
-- empresa y solución (columna generada única) y uno por solicitud de la web: abrir dos veces no duplica nada.
--
-- `implementation_milestones`: hitos y pendientes de la orden, con responsable, fecha (solo si una persona la fija) y
-- quién los cerró. Los marcados como obligatorios deben estar hechos para confirmar que está preparada.
--
-- `implementation_events`: historial de cada expediente (creado, asignado, propuesta, aceptado, hitos, preparada,
-- habilitada, comunicada, iniciada, cancelada, notas). Solo se añaden filas: nunca se editan.
--
-- Sin estas tablas el plano de control funciona igual: la función no se monta.
--
-- irreversible: el código anterior ignora estas tablas, así que no hace falta borrarlas para volver atrás; conservan la traza de lo pactado con cada cliente.

CREATE TABLE implementation_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  reference VARCHAR(32) NOT NULL,
  status VARCHAR(16) NOT NULL,
  company_id BIGINT UNSIGNED NOT NULL,
  opportunity_id BIGINT UNSIGNED NULL,
  lead_request_id BIGINT UNSIGNED NULL,
  contract_id BIGINT UNSIGNED NULL,
  solution_key VARCHAR(64) NOT NULL,
  solution_name VARCHAR(200) NOT NULL,
  request_snapshot JSON NULL,
  assignee_id VARCHAR(100) NULL,
  assignee_name VARCHAR(160) NULL,
  queue VARCHAR(32) NULL,
  conditions VARCHAR(4000) NULL,
  timeline VARCHAR(2000) NULL,
  target_date BIGINT NULL,
  start_mode VARCHAR(16) NULL,
  terms_by VARCHAR(100) NULL,
  terms_at BIGINT NULL,
  accepted_at BIGINT NULL,
  ready_at BIGINT NULL,
  ready_by VARCHAR(100) NULL,
  tenant_id VARCHAR(64) NULL,
  enabled_at BIGINT NULL,
  communicated_at BIGINT NULL,
  subscription_id BIGINT UNSIGNED NULL,
  started_at BIGINT NULL,
  trial_ends_at BIGINT NULL,
  cancelled_at BIGINT NULL,
  cancel_reason VARCHAR(500) NULL,
  last_error VARCHAR(300) NULL,
  open_slot VARCHAR(100) GENERATED ALWAYS AS (IF(status IN ('started', 'cancelled'), NULL, CONCAT(company_id, ':', solution_key))) STORED,
  version INT NOT NULL DEFAULT 1,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_implementation_reference (reference),
  UNIQUE KEY uq_implementation_open (open_slot),
  UNIQUE KEY uq_implementation_lead_request (lead_request_id),
  KEY ix_implementation_status (status, updated_at),
  KEY ix_implementation_company (company_id),
  KEY ix_implementation_opportunity (opportunity_id),
  KEY ix_implementation_assignee (assignee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE implementation_milestones (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(12) NOT NULL,
  title VARCHAR(200) NOT NULL,
  required TINYINT(1) NOT NULL DEFAULT 1,
  status VARCHAR(12) NOT NULL,
  assignee_id VARCHAR(100) NULL,
  assignee_name VARCHAR(160) NULL,
  due_at BIGINT NULL,
  note VARCHAR(1000) NULL,
  position INT NOT NULL DEFAULT 0,
  done_at BIGINT NULL,
  done_by VARCHAR(100) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_implementation_milestone_order (order_id, position, id),
  CONSTRAINT fk_implementation_milestone FOREIGN KEY (order_id) REFERENCES implementation_orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE implementation_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  type VARCHAR(24) NOT NULL,
  detail VARCHAR(2000) NULL,
  PRIMARY KEY (id),
  KEY ix_implementation_event_order (order_id, id),
  CONSTRAINT fk_implementation_event FOREIGN KEY (order_id) REFERENCES implementation_orders (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
