-- Reversión de 0025_crm_settings: se pierden los ajustes del CRM y su historial (los avisos de solicitudes dejan de
-- enviarse; las solicitudes se siguen registrando). Antes, desplegar el código anterior a los ajustes.
DROP TABLE crm_settings_history;
DROP TABLE crm_settings;
