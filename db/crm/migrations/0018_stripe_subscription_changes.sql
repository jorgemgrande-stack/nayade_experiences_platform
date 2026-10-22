-- Big Elephant — Cambios de partidas enviados a Stripe (aditiva).
--
-- Cada compra de un módulo o ampliación desde la plataforma es un pedido de cambio (`commercial_orders`, kind
-- `change`) y UN cambio de partidas de la suscripción de Stripe con cobro condicionado (pending_if_incomplete):
-- Stripe solo lo aplica si cobra el prorrateo. Esta tabla guarda lo que el servidor PIDIÓ (partidas esperadas,
-- clave de idempotencia y factura) para reconocer después, releyendo Stripe, si el cambio se aplicó (cobrado),
-- sigue pendiente o caducó (sin cobro: no se concede nada).
--
--  - Un pedido, un cambio (order_id único). Una suscripción solo tiene un cambio `pending` a la vez (columna
--    generada única): dos compras simultáneas incompatibles no pueden convivir.
--  - Nunca se borra nada: un cambio caducado o fallido queda como histórico.
--
-- No cambia ningún dato existente. Nunca se ejecuta al arrancar. `livemode` como en 0012/0013.
-- Diseño: docs/elephant-source/DISENO_COMPRA_MODULOS.md.

CREATE TABLE stripe_subscription_changes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  order_id INT NOT NULL,
  company_id INT NOT NULL,
  stripe_subscription_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  idempotency_key VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  items_json JSON NOT NULL,
  expected_items_json JSON NOT NULL,
  status ENUM('pending','applied','expired','failed') NOT NULL DEFAULT 'pending',
  stripe_invoice_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  amount_due_cents INT NULL,
  expires_at BIGINT NULL,
  detail VARCHAR(300) NULL,
  created_by VARCHAR(100) NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  pending_subscription VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
    GENERATED ALWAYS AS (IF(status = 'pending', stripe_subscription_id, NULL)) STORED,
  UNIQUE KEY uq_sub_change_order (order_id),
  UNIQUE KEY uq_sub_change_key (idempotency_key),
  UNIQUE KEY uq_sub_change_pending (pending_subscription),
  KEY ix_sub_change_subscription (stripe_subscription_id),
  CONSTRAINT fk_sub_change_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_sub_change_livemode CHECK (livemode IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
