-- Big Elephant — Consentimiento comercial por contacto y finalidad, y Centro de envíos del CRM (aditiva, base del CRM).
--
-- `crm_contact_consents`: estado VIGENTE del consentimiento de cada contacto para cada finalidad comercial
--   (`newsletter` = novedades, `recommendations` = recomendaciones, `promotions` = promociones y campañas): concedido o
--   retirado, origen, evidencia (texto aceptado, formulario, referencia), fecha de concesión y fecha de baja. Es una
--   proyección del historial: se recalcula con cada cambio y nunca es la única prueba.
-- `crm_contact_consent_events`: historial INMUTABLE de cada concesión, retirada o baja (quién, cuándo, origen,
--   evidencia e IP seudonimizada de las bajas públicas). Solo se añaden filas; el código nunca las modifica ni borra.
-- `comm_sends`: envíos manuales del Centro de envíos (plantilla, contenido, filtros de destinatarios, estado, quién lo
--   creó y quién lo confirmó).
-- `comm_send_recipients`: destinatarios congelados al confirmar, con su elegibilidad. Clave única (envío, huella del
--   correo) = un correo por envío y persona, también si se repite la confirmación (la bandeja de salida usa además la
--   clave `comm:<envío>:r<destinatario>`). Sin direcciones completas: el correo se vuelve a leer del CRM al enviar.
-- `comm_survey_responses`: valoración (1-5) y comentario de la encuesta de soporte, una por ticket.
-- `comm_link_secrets`: secreto aleatorio de la firma de los enlaces públicos (baja y encuesta), generado por la
--   aplicación la primera vez; no depende de ninguna variable de entorno.
-- Sin estas tablas el plano de control funciona igual: no se monta el Centro de envíos.
--
-- irreversible: el historial de consentimientos y bajas es la prueba exigible del consentimiento (RGPD y LSSI); el código anterior ignora estas tablas, así que no hace falta borrarlas para volver atrás.

CREATE TABLE crm_contact_consents (
  contact_id BIGINT UNSIGNED NOT NULL,
  purpose VARCHAR(24) NOT NULL,
  status VARCHAR(16) NOT NULL,
  source VARCHAR(200) NULL,
  evidence VARCHAR(1000) NULL,
  granted_at BIGINT NULL,
  withdrawn_at BIGINT NULL,
  updated_by VARCHAR(120) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (contact_id, purpose),
  KEY ix_consent_purpose (purpose, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE crm_contact_consent_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  contact_id BIGINT UNSIGNED NOT NULL,
  purpose VARCHAR(24) NOT NULL,
  action VARCHAR(16) NOT NULL,
  source VARCHAR(200) NULL,
  evidence VARCHAR(1000) NULL,
  ip_hash CHAR(16) NULL,
  actor VARCHAR(120) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  KEY ix_consent_events_contact (contact_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE comm_sends (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  template_id VARCHAR(64) NOT NULL,
  title VARCHAR(160) NOT NULL,
  content_json JSON NOT NULL,
  audience_json JSON NOT NULL,
  status VARCHAR(16) NOT NULL,
  recipients_count INT UNSIGNED NULL,
  eligible_count INT UNSIGNED NULL,
  version INT UNSIGNED NOT NULL DEFAULT 1,
  created_by VARCHAR(120) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  confirmed_by VARCHAR(120) NULL,
  confirmed_at BIGINT NULL,
  finished_at BIGINT NULL,
  PRIMARY KEY (id),
  KEY ix_sends_recent (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE comm_send_recipients (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  send_id BIGINT UNSIGNED NOT NULL,
  recipient_key CHAR(64) NOT NULL,
  source VARCHAR(16) NOT NULL,
  contact_id BIGINT UNSIGNED NULL,
  company_id BIGINT UNSIGNED NULL,
  tenant_id VARCHAR(64) NULL,
  ticket_id BIGINT UNSIGNED NULL,
  label VARCHAR(200) NULL,
  email_masked VARCHAR(200) NULL,
  status VARCHAR(16) NOT NULL,
  reason VARCHAR(64) NULL,
  outbox_id BIGINT UNSIGNED NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_send_recipient (send_id, recipient_key),
  KEY ix_send_recipients_status (send_id, status),
  KEY ix_send_recipients_ticket (ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE comm_survey_responses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id BIGINT UNSIGNED NOT NULL,
  tenant_id VARCHAR(64) NULL,
  send_id BIGINT UNSIGNED NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(2000) NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_survey_ticket (ticket_id),
  KEY ix_survey_send (send_id, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE comm_link_secrets (
  purpose VARCHAR(32) NOT NULL,
  secret CHAR(64) NOT NULL,
  created_at BIGINT NOT NULL,
  PRIMARY KEY (purpose)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
