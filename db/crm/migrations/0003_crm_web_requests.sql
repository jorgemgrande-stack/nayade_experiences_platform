-- Solicitudes comerciales recibidas desde la web pública (www.bigelephant.es).
--
-- Cada envío de un formulario es una SOLICITUD que cuelga de un lead existente o nuevo: el lead
-- sigue siendo la entidad comercial (estado, responsable, historial, conversión a empresa y
-- oportunidad). Aquí solo se guarda lo que el lead no tiene: tipo de solicitud, configuración
-- elegida, mensaje, consentimientos, idempotencia y si el equipo ya la ha atendido.
-- Aditiva: no modifica tablas existentes.
CREATE TABLE crm_lead_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  lead_id INT NOT NULL,
  -- Referencia pública que ve el visitante (no revela ids internos)
  reference VARCHAR(16) NOT NULL,
  type ENUM('trial','onboarding','contact','configuration','extension_info','module_info') NOT NULL,
  status ENUM('pending','attended','discarded') NOT NULL DEFAULT 'pending',
  sector VARCHAR(100) NULL,
  message TEXT NULL,
  -- Configuración de «Construye tu Elephant»: {plan, extensions[], industries[], interests[]}
  configuration JSON NULL,
  -- Extensión o módulo por el que se pregunta (tipos *_info)
  interest VARCHAR(64) NULL,
  -- Preferencia horaria indicada (onboarding). No es una cita: el equipo propone la fecha.
  preferred_time VARCHAR(200) NULL,
  source_page VARCHAR(200) NULL,
  utm JSON NULL,
  privacy_accepted_at BIGINT NOT NULL,
  privacy_version VARCHAR(32) NOT NULL,
  marketing_consent TINYINT(1) NOT NULL DEFAULT 0,
  -- Reintentos del mismo envío: misma clave → misma respuesta, nunca dos solicitudes
  idempotency_key CHAR(36) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  -- Seudónimo de la IP (HMAC), solo para abuso; nunca la IP en claro
  ip_hash CHAR(64) NULL,
  attended_at BIGINT NULL,
  attended_by VARCHAR(100) NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_request_reference (reference),
  UNIQUE KEY uq_request_idempotency (idempotency_key),
  KEY idx_request_lead (lead_id),
  KEY idx_request_status_type (status, type),
  KEY idx_request_created (created_at),
  CONSTRAINT fk_request_lead FOREIGN KEY (lead_id) REFERENCES crm_leads (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
