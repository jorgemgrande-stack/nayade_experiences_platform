-- Big Elephant — Revocar las sesiones de un usuario (aditiva, BD de cada empresa).
--
-- `sessionsRevokedAt`: las sesiones emitidas hasta ese instante (claim `iat` del JWT, en segundos) dejan de valer; las
-- posteriores, sí. Lo fija el administrador central (Accesos → «Cerrar sesiones») sin tocar la contraseña ni el estado.
-- NULL = nunca se revocó (comportamiento anterior).
--
-- Solo añade una columna nula. Nunca se ejecuta al arrancar.

ALTER TABLE users
  ADD COLUMN sessionsRevokedAt TIMESTAMP NULL DEFAULT NULL;
