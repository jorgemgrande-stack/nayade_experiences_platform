-- irreversible: tablas nuevas y aditivas (sin datos previos); revertir el código las deja sin uso, no se eliminan (expand/contract)
-- Trazabilidad de los suplementos realmente pagados (p. ej. Lifetime Access de RECONNECT) y su ámbito. Aditiva, BD de cada empresa.
--
-- order_supplement_lines: un suplemento elegido en una línea de pedido (se guarda al crear el pedido, con el tramo e importe que
--   fijó el servidor). El derecho de acceso que concede (learning_enrollment_id) se enlaza al conceder, para poder reembolsar
--   SOLO ese suplemento sin tocar el resto de derechos del pedido.
-- supplement_variant_scope: opciones del programa con las que se puede contratar un suplemento (sin filas activas = sin restricción;
--   al cambiar el ámbito las filas se desactivan, no se borran).
-- No se rellena ningún dato. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS order_supplement_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reservation_id INT NOT NULL,
  merchant_order VARCHAR(40) NOT NULL,
  product_id INT NOT NULL,
  variant_id INT NOT NULL,
  supplement_group VARCHAR(64) NOT NULL,
  name VARCHAR(255) NOT NULL,
  quantity INT NOT NULL,
  unit_cents INT NOT NULL,
  total_cents INT NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  learning_enrollment_id INT NULL,
  refunded_at BIGINT NULL,
  refund_reason VARCHAR(255) NULL,
  created_at BIGINT NOT NULL,
  UNIQUE KEY uq_order_supplement (reservation_id, supplement_group),
  KEY idx_order_supplement_order (merchant_order)
);

CREATE TABLE IF NOT EXISTS supplement_variant_scope (
  supplement_variant_id INT NOT NULL,
  programme_variant_id INT NOT NULL,
  active TINYINT NOT NULL DEFAULT 1,
  PRIMARY KEY (supplement_variant_id, programme_variant_id)
);
