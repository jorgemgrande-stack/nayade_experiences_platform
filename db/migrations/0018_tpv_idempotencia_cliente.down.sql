-- Reversión de 0018_tpv_idempotencia_cliente: el TPV vuelve a aceptar cobros repetidos y las ventas pierden el enlace al
-- cliente (siguen apareciendo en su historial por el correo). Antes, desplegar el código anterior a este cambio.
ALTER TABLE reservations
  DROP KEY idx_reservations_client,
  DROP COLUMN client_id;

ALTER TABLE tpv_sales
  DROP KEY idx_tpv_sales_client,
  DROP KEY uq_tpv_sales_idempotency_key,
  DROP COLUMN clientId,
  DROP COLUMN idempotencyKey;
