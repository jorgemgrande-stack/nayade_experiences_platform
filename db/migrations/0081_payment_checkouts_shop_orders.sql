-- Cobros con la cuenta Stripe de cada empresa: pedidos de la tienda web. Aditiva, BD de cada empresa.
--
-- payment_checkouts (0080) pasa a servir también a los pedidos del carrito de la tienda:
--   `kind`           'quote' (presupuesto, como hasta ahora) o 'shop_order' (pedido del carrito). Por defecto 'quote':
--                    las filas existentes no cambian.
--   `merchant_order` identificador del pedido (el mismo `merchantOrder` de las reservas pendientes de pago). Solo para
--                    pedidos de la tienda.
--   `quote_id`       deja de ser obligatorio (un pedido de la tienda no tiene presupuesto).
-- Sin claves foráneas. Nunca se ejecuta al arrancar. Requiere 0080.

ALTER TABLE payment_checkouts
  ADD COLUMN kind VARCHAR(12) NOT NULL DEFAULT 'quote',
  ADD COLUMN merchant_order VARCHAR(32) NULL,
  MODIFY COLUMN quote_id INT NULL,
  ADD KEY idx_payment_checkouts_order (merchant_order),
  ADD CONSTRAINT chk_payment_checkouts_kind CHECK (kind IN ('quote','shop_order'));
