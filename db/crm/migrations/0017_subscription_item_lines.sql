-- Big Elephant — partidas comerciales (aditiva). Cada partida de la suscripción guarda, como parte de su
-- instantánea, qué es: el plan, un módulo, una ampliación por cantidad (usuarios, sedes, almacenamiento) o
-- un servicio; y, si es una ampliación, de qué métrica. Las partidas anteriores quedan con NULL (se deduce
-- del catálogo al leerlas). Nunca se ejecuta al arrancar. Diseño: docs/elephant-source/DISENO_COMPRA_MODULOS.md.

ALTER TABLE subscription_items
  ADD COLUMN line_kind ENUM('plan','module','quantity','service') NULL AFTER family,
  ADD COLUMN metric VARCHAR(20) NULL AFTER line_kind,
  ADD CONSTRAINT chk_item_quantity_metric CHECK (line_kind IS NULL OR line_kind <> 'quantity' OR metric IS NOT NULL);
