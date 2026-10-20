-- Big Elephant — comprobaciones de NIF-IVA intracomunitarios en VIES (aditiva). Una fila por consulta: país, número
-- (sin prefijo), resultado (válido, no válido o servicio no disponible), número de consulta de VIES (prueba de la
-- comprobación), nombre y dirección que devuelve VIES, motivo y fecha. La inversión del sujeto pasivo solo se
-- aplica con una comprobación válida y reciente. Nunca se ejecuta al arrancar; sin esta tabla, el cobro con
-- inversión del sujeto pasivo queda bloqueado (no hay evidencia). Diseño: server/stripe/vies.ts.

CREATE TABLE stripe_vat_checks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  country CHAR(2) NOT NULL,
  vat_number VARCHAR(20) NOT NULL,
  status ENUM('valid','invalid','unavailable') NOT NULL,
  consultation_number VARCHAR(64) NULL,
  trader_name VARCHAR(400) NULL,
  trader_address VARCHAR(400) NULL,
  detail VARCHAR(64) NULL,
  order_id INT NULL,
  checked_at BIGINT NOT NULL,
  KEY idx_vat_checks_number (livemode, country, vat_number, status, checked_at),
  KEY idx_vat_checks_order (order_id),
  CONSTRAINT chk_vat_checks_livemode CHECK (livemode IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
