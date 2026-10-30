-- Reversión de 0017_email_change_tokens: los enlaces de cambio de correo pendientes dejan de valer (los cambios ya
-- aplicados se conservan). Antes, desplegar el código anterior al cambio de correo.
DROP TABLE IF EXISTS email_change_tokens;
