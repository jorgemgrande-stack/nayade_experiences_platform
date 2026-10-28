-- Big Elephant — Cobro de los cargos extraordinarios y gastos variables (aditiva, base del CRM).
--
-- Un registro por intento de cobro de un cargo aprobado (`billing_charges`): un enlace de pago de Stripe (Checkout en
-- modo `payment`, cobro único, con el IVA como tipo fijo) o un pago externo registrado por un operador (transferencia u
-- otro medio, con su referencia). El estado de cobro de la factura del cargo se actualiza a partir de aquí. El cobro con
-- Stripe solo se da por hecho con el webhook firmado y releyendo la sesión en Stripe (importe y cliente comprobados).
-- Sin esta tabla el plano de control funciona igual: los cargos se aprueban y facturan, pero no se cobran desde aquí.
--
-- irreversible: es la traza de cobros reales vinculada a facturas que se conservan por obligación legal.

CREATE TABLE billing_charge_payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  charge_id BIGINT UNSIGNED NOT NULL,
  kind VARCHAR(16) NOT NULL,
  status VARCHAR(16) NOT NULL,
  amount_cents INT NOT NULL,
  total_cents INT NOT NULL,
  currency CHAR(3) NOT NULL,
  stripe_session_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  stripe_payment_intent_id VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  reference VARCHAR(120) NULL,
  expires_at BIGINT NULL,
  created_by VARCHAR(120) NOT NULL,
  created_at BIGINT NOT NULL,
  paid_at BIGINT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_charge_payment_session (livemode, stripe_session_id),
  KEY ix_charge_payment_charge (livemode, charge_id)
);
