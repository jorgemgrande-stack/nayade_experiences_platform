-- Big Elephant — Cobro del TPV sin duplicados y con el cliente enlazado (aditiva, BD de cada empresa).
--
-- `tpv_sales.idempotencyKey`: clave que genera el TPV en cada intento de cobro. Un doble clic o un reintento con la
-- misma clave no crea una segunda venta. Índice único: NULL no colisiona (las ventas anteriores y las de otros canales
-- la dejan vacía). Origen: Skicenter, commit 0a6a535b (migración 0332).
-- `tpv_sales.clientId` y `reservations.client_id`: cliente del CRM al que pertenece la venta (elegido por el cajero o
-- resuelto por su correo), para que aparezca en su historial aunque cambie de correo. Origen: Skicenter, commit adda0548.
--
-- Solo añade columnas nulas e índices. Nunca se ejecuta al arrancar.

ALTER TABLE tpv_sales
  ADD COLUMN idempotencyKey VARCHAR(64) NULL DEFAULT NULL,
  ADD COLUMN clientId INT NULL DEFAULT NULL,
  ADD UNIQUE KEY uq_tpv_sales_idempotency_key (idempotencyKey),
  ADD KEY idx_tpv_sales_client (clientId);

ALTER TABLE reservations
  ADD COLUMN client_id INT NULL DEFAULT NULL,
  ADD KEY idx_reservations_client (client_id);
