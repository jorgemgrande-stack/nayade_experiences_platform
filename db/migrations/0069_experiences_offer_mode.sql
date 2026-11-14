-- Oferta «bajo petición» / «próximamente» (E-6). Aditiva, BD de cada empresa.
--
-- `experiences.offer_mode`: cómo se ofrece el producto. 'fixed' (por defecto: precio fijo, se compra como siempre),
--   'on_request' (bajo petición) o 'coming_soon' (próximamente). En los dos últimos la web no muestra precio ni deja
--   comprar: solo ofrece pedir información, y el servidor rechaza cualquier compra del producto.
-- `experiences.request_cta_label`: texto del botón de petición (NULL = «Solicitar información»).
--
-- Los productos que ya existen quedan en 'fixed': no cambia nada para ninguna empresa. Nunca se ejecuta al arrancar.

ALTER TABLE experiences
  ADD COLUMN offer_mode ENUM('fixed','on_request','coming_soon') NOT NULL DEFAULT 'fixed',
  ADD COLUMN request_cta_label VARCHAR(80) NULL;
