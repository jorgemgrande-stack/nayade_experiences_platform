-- Big Elephant — Perfil fiscal del comprador de un pedido (B2B y B2C) para la contratación con Stripe (aditiva).
--
-- Una fila por pedido: tipo de cliente (empresa o profesional / particular), territorio fiscal deducido del
-- país y del código postal, escenario fiscal, identificador fiscal SIN verificar y el registro del
-- consentimiento (versiones aceptadas, fechas y huella; nunca el texto). Cada cambio deja una fila en el
-- historial. `livemode` sigue la convención de 0012/0013: cada entorno solo ve sus filas.
--
-- No cambia ningún dato existente. Nunca se ejecuta al arrancar. Sin esta tabla el plano de control sigue
-- funcionando, pero en modo live Checkout no se abre (falta el perfil fiscal).
-- Diseño: server/stripe/buyerProfile.ts y docs/elephant-source/CONTRATACION_B2B_B2C.md.

CREATE TABLE stripe_buyer_profiles (
  order_id INT NOT NULL PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  buyer_type ENUM('business','consumer') NOT NULL,
  territory ENUM('es_mainland','es_canarias','es_ceuta','es_melilla','eu','eu_special','non_eu') NOT NULL,
  scenario VARCHAR(32) NOT NULL,
  country CHAR(2) NOT NULL,
  postal_code VARCHAR(12) NULL,
  display_name VARCHAR(200) NOT NULL,
  tax_id VARCHAR(40) NULL,
  tax_id_status ENUM('none','unverified') NOT NULL DEFAULT 'none',
  billing_email VARCHAR(200) NULL,
  contact_name VARCHAR(120) NULL,
  consent_json JSON NOT NULL,
  version INT NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  CONSTRAINT fk_buyer_profile_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_buyer_profile_livemode CHECK (livemode IN (0,1)),
  CONSTRAINT chk_buyer_profile_business CHECK (buyer_type = 'consumer' OR tax_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE stripe_buyer_profile_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  version INT NOT NULL,
  actor VARCHAR(120) NOT NULL,
  -- Instantánea del perfil en esa versión (incluido el consentimiento), para la trazabilidad
  snapshot_json JSON NOT NULL,
  at BIGINT NOT NULL,
  UNIQUE KEY uq_buyer_profile_event (order_id, version),
  CONSTRAINT fk_buyer_profile_event_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_buyer_profile_event_livemode CHECK (livemode IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
