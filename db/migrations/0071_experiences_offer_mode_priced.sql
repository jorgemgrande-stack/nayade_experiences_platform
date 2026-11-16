-- Oferta «precio visible, solo por solicitud» (priced_request). Aditiva, BD de cada empresa.
--
-- Amplía experiences.offer_mode con un valor nuevo: el producto muestra su precio (y sus opciones con precio) pero NO se
-- puede comprar online: el botón es de solicitud y el servidor rechaza cualquier compra (igual que 'on_request').
-- Los productos existentes no cambian ('fixed', 'on_request' y 'coming_soon' siguen igual). Nunca se ejecuta al arrancar.

ALTER TABLE experiences
  MODIFY COLUMN offer_mode ENUM('fixed','on_request','coming_soon','priced_request') NOT NULL DEFAULT 'fixed';
