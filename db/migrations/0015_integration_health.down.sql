-- Reversión de 0015_integration_health: se pierde el historial de comprobaciones de integraciones (no hay secretos ni
-- datos del negocio). Antes, desplegar el código anterior a las comprobaciones.
DROP TABLE IF EXISTS integration_events;
DROP TABLE IF EXISTS integration_status;
