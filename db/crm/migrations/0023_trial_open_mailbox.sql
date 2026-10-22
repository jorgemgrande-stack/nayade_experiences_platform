-- Antiabuso del alta autoservicio: una sola prueba ABIERTA por buzón, impuesto por la BD.
-- Buzón canónico (igual que canonicalMailbox en server/trials/service.ts): minúsculas, sin «+etiqueta» y, en Gmail,
-- sin puntos y con googlemail.com como gmail.com. Así «a.na+x@gmail.com» y «ana@googlemail.com» son el mismo buzón y
-- dos altas simultáneas con alias distintos no pueden pasar las dos. Aditiva: el código anterior no escribe nada nuevo.
--
-- Antes de aplicar, comprobar que no hay dos pruebas abiertas del mismo buzón (si las hay, el ALTER falla sin cambiar
-- nada y hay que cerrar a mano la sobrante). Misma expresión que la columna:
--   SELECT mb, COUNT(*) FROM (SELECT <expresión de open_mailbox> AS mb FROM trial_requests) x
--    WHERE mb IS NOT NULL GROUP BY mb HAVING COUNT(*) > 1;
ALTER TABLE trial_requests
  ADD COLUMN open_mailbox VARCHAR(254) GENERATED ALWAYS AS (
    IF(state IN ('converted','rejected','cancelled'), NULL,
      CONCAT(
        IF(SUBSTRING_INDEX(LOWER(email), '@', -1) IN ('gmail.com','googlemail.com'),
          REPLACE(
            IF(LOCATE('+', LEFT(LOWER(email), CHAR_LENGTH(email) - CHAR_LENGTH(SUBSTRING_INDEX(email, '@', -1)) - 1)) > 1,
              LEFT(LOWER(email), LOCATE('+', LOWER(email)) - 1),
              LEFT(LOWER(email), CHAR_LENGTH(email) - CHAR_LENGTH(SUBSTRING_INDEX(email, '@', -1)) - 1)),
            '.', ''),
          IF(LOCATE('+', LEFT(LOWER(email), CHAR_LENGTH(email) - CHAR_LENGTH(SUBSTRING_INDEX(email, '@', -1)) - 1)) > 1,
            LEFT(LOWER(email), LOCATE('+', LOWER(email)) - 1),
            LEFT(LOWER(email), CHAR_LENGTH(email) - CHAR_LENGTH(SUBSTRING_INDEX(email, '@', -1)) - 1))),
        '@',
        IF(SUBSTRING_INDEX(LOWER(email), '@', -1) = 'googlemail.com', 'gmail.com', SUBSTRING_INDEX(LOWER(email), '@', -1))))
  ) STORED,
  ADD UNIQUE KEY uq_trial_open_mailbox (open_mailbox);
