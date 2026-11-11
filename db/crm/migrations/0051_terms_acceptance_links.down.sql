-- Reversión de 0051: quita los enlaces recuperables y el historial de envíos de la aceptación de las condiciones
-- personalizadas. Los enlaces ya enviados siguen funcionando (se buscan por su huella), pero el operador ya no puede
-- volver a consultarlos ni reenviarlos; se pierde el historial de envíos (la bandeja de salida conserva los mensajes).
DROP TABLE IF EXISTS commercial_terms_acceptance_sends;
DROP TABLE IF EXISTS commercial_terms_acceptance_links;
