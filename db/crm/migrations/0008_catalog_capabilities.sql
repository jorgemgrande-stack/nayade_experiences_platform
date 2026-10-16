-- Big Elephant — catálogo oficial de Elephant Source (aditiva): nuevo tipo de entrada «capability»
-- en el catálogo comercial. Añadir un valor al final de un ENUM es un cambio de metadatos (no
-- reescribe la tabla). Los nuevos campos de producto (familias Net/Connect, estado comercial,
-- capacidades, paquetes, cupos) van dentro del JSON del borrador: no necesitan columnas.

ALTER TABLE web_entries
  MODIFY kind ENUM('product','promotion','faq','menu','seo','page','forms','capability') NOT NULL;
