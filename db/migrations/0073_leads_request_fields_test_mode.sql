-- Solicitudes de producto: idioma, modalidad y precio mostrado como campos propios, y marca de prueba. Aditiva, BD de cada empresa.
--
-- leads.request_lang (idioma de la web que veía la persona), variant_id / variant_label (modalidad elegida), shown_price (precio
-- publicado en ese momento) e is_test (solicitud creada por un administrador en modo de pruebas: sin avisos ni integraciones
-- externas). Todas nullable salvo is_test (0 por defecto): los leads existentes no cambian. Nunca se ejecuta al arrancar.

ALTER TABLE leads
  ADD COLUMN request_lang VARCHAR(5) NULL,
  ADD COLUMN variant_id INT NULL,
  ADD COLUMN variant_label VARCHAR(128) NULL,
  ADD COLUMN shown_price DECIMAL(10,2) NULL,
  ADD COLUMN is_test TINYINT(1) NOT NULL DEFAULT 0;
