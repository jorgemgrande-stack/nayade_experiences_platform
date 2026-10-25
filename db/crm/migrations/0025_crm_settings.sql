-- Big Elephant — Ajustes administrables del CRM con historial (aditiva, base del CRM).
--
-- `crm_settings`: un ajuste por clave (JSON validado por el plano de control) con versión optimista.
--   Primer uso: `lead_notices`, quién recibe el aviso interno de cada tipo de solicitud de la web.
-- `crm_settings_history`: copia inmutable de cada versión guardada (quién y cuándo), para consultar y recuperar.
-- Sin estas tablas el plano de control funciona igual: las solicitudes se registran y no se avisa a nadie.

CREATE TABLE crm_settings (
  setting_key VARCHAR(64) NOT NULL,
  value_json JSON NOT NULL,
  version INT UNSIGNED NOT NULL,
  updated_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (setting_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE crm_settings_history (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  setting_key VARCHAR(64) NOT NULL,
  version INT UNSIGNED NOT NULL,
  value_json JSON NOT NULL,
  updated_by VARCHAR(100) NOT NULL,
  updated_at BIGINT NOT NULL,
  note VARCHAR(200) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_setting_version (setting_key, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
