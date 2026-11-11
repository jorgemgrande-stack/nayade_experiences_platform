-- Big Elephant — Pago por transferencia de las notas de cobro de clientes externos (aditiva).
--
-- `billing_charge_payments` (0029) admite ahora el pago por transferencia que registra un administrador desde la ficha
-- de la operación externa, con el justificante en PDF guardado en el almacén privado (`fin_documents`, 0035):
--   - `method`: medio declarado del pago externo (`bank_transfer`); NULL en las filas anteriores (Stripe u otro medio).
--   - `receipt_document_id`: justificante vigente (fin_documents.id). Los anteriores de una rectificación se conservan.
--   - `idempotency_key`: clave del formulario; repetir el envío devuelve el mismo pago (único por entorno).
--   - `settles_charge_id`: el cargo que liquida ESTE pago. Único por entorno: como mucho un pago liquida cada cargo, así
--     que un cobro de Stripe que llegue después de la transferencia (o al revés) no se cuenta dos veces aunque lleguen a
--     la vez; el segundo queda señalado (`status = duplicate`) para revisarlo y reembolsarlo. NULL en las filas
--     anteriores, que siguen protegidas por el estado de cobro de su factura.
--   - `voided_*`: anulación administrativa de un pago registrado por error (con motivo). La fila se conserva.
-- Las filas existentes quedan exactamente igual (columnas nuevas a NULL).
--
-- irreversible: es la traza de cobros reales vinculada a facturas que se conservan por obligación legal (como 0029).

ALTER TABLE billing_charge_payments
  ADD COLUMN method VARCHAR(20) NULL,
  ADD COLUMN receipt_document_id BIGINT UNSIGNED NULL,
  ADD COLUMN idempotency_key VARCHAR(80) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD COLUMN settles_charge_id BIGINT UNSIGNED NULL,
  ADD COLUMN voided_at BIGINT NULL,
  ADD COLUMN voided_by VARCHAR(120) NULL,
  ADD COLUMN void_reason VARCHAR(300) NULL,
  ADD UNIQUE KEY uq_charge_payment_idem (livemode, idempotency_key),
  ADD UNIQUE KEY uq_charge_payment_settles (livemode, settles_charge_id),
  ADD KEY ix_charge_payment_paid (livemode, status, paid_at);
