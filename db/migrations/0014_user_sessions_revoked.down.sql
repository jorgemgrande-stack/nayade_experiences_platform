-- Reversión de 0014_user_sessions_revoked: las revocaciones registradas dejan de aplicarse (las sesiones cerradas
-- vuelven a valer si su JWT no ha caducado). Antes, desplegar el código anterior a la revocación de sesiones.
ALTER TABLE users
  DROP COLUMN sessionsRevokedAt;
