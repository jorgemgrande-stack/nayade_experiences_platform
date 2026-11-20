-- Pedido de tienda → opción comprada. Aditiva, BD de cada empresa, nunca se ejecuta al arrancar.
--
-- `reservations.variant_id`: la variante (experience_variants.id) que el comprador eligió al crear la línea del pedido.
-- Hasta ahora solo se guardaba `stock_variant_id` en artículos inventariables, así que tras el pago no se podía saber
-- INEQUÍVOCAMENTE qué opción se había comprado. Lo usa el LMS (learning_access_rules por producto + variante) para
-- matricular solo en lo contratado. NULL = sin variante o línea anterior a esta migración (no concede matrícula por regla
-- de variante). Sin clave foránea (como el resto de este carril).
ALTER TABLE reservations
  ADD COLUMN variant_id INT NULL DEFAULT NULL;
