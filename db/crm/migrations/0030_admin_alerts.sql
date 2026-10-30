-- Big Elephant — Alertas administrativas (familia D): registro de cada aviso interno y cursor de lectura (aditiva,
-- base del CRM).
--
-- `admin_alert_log`: un hecho por fila y tipo de alerta (clave única: idempotencia por evento; repetir el hecho no
-- añade fila ni vuelve a avisar). Guarda la prioridad efectiva, el estado del aviso (enviado, agrupado, resumido,
-- desactivado, sin destinatarios…), un resumen sin datos sensibles, la empresa y el enlace al expediente del CRM. Es
-- el historial que se consulta desde el CRM y la base de la agrupación de avisos repetidos.
-- `admin_alert_state`: posiciones de lectura (p. ej. el último evento comercial revisado), para no avisar nunca de
-- hechos anteriores a la activación.
-- La configuración (destinatarios, prioridades, frecuencia) vive en `crm_settings` (0025), con su historial.
-- Sin estas tablas el plano de control funciona igual: no se envían alertas administrativas.
--
-- irreversible: es el historial de avisos internos (trazabilidad de lo notificado); el código anterior ignora estas tablas, así que no hace falta borrarlas para volver atrás.

CREATE TABLE admin_alert_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  alert_id VARCHAR(64) NOT NULL,
  event_key VARCHAR(190) NOT NULL,
  severity VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  tenant_id VARCHAR(64) NULL,
  company_id BIGINT UNSIGNED NULL,
  company VARCHAR(160) NULL,
  summary VARCHAR(400) NOT NULL,
  link VARCHAR(300) NULL,
  recipients SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  occurred_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL,
  digest_at BIGINT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_admin_alert_event (alert_id, event_key),
  KEY ix_admin_alert_recent (alert_id, created_at),
  KEY ix_admin_alert_status (status, alert_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE admin_alert_state (
  name VARCHAR(64) NOT NULL,
  value BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
