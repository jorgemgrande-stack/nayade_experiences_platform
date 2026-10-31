-- Big Elephant — Finanzas corporativas, fase 4: control diario, informes y análisis (aditiva, base del CRM).
--
-- Casi todo es LECTURA del libro (0033), las operaciones (0035), Stripe (0036) y la gestoría (0037): los informes no
-- guardan copias. Solo se añaden:
-- `fin_daily_reviews`: revisión del control diario, una fila por día (único): quién y cuándo lo revisó, nota y una
--   instantánea JSON con los recuentos del día en ese momento. Repetir la revisión no crea otra fila; solo la nota se
--   puede editar, y cada edición queda en la bitácora.
-- `fin_daily_review_log`: bitácora de cada revisión (alta y ediciones de la nota con su texto anterior y el nuevo),
--   solo inserción.
-- `fin_expense_categories.is_direct_cost`: marca de coste directo de una categoría de gasto para el margen bruto.
--   NULL = según su cuenta (lo resuelve el código: 626 y las categorías de hosting o infraestructura son coste directo);
--   1 o 0 cuando el operador la fija. Sin valores escritos aquí: las filas existentes quedan en NULL.
-- Índice de gastos por fecha de registro (control diario).
-- Sin estas tablas el libro, las operaciones, Stripe y la gestoría funcionan igual: el análisis no se monta.
--
-- irreversible: la revisión diaria y su bitácora son traza de control interno que se conserva con los libros contables (seis años, art. 30 del Código de Comercio); el código anterior ignora las tablas y la columna nueva, así que volver atrás no exige quitarlas.

CREATE TABLE fin_daily_reviews (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_day DATE NOT NULL,
  reviewed_by VARCHAR(100) NOT NULL,
  reviewed_at BIGINT NOT NULL,
  note VARCHAR(1000) NULL,
  snapshot_json TEXT NOT NULL,
  note_edited_by VARCHAR(100) NULL,
  note_edited_at BIGINT NULL,
  request_id VARCHAR(100) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_fin_daily_review_day (review_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE fin_daily_review_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  review_id BIGINT UNSIGNED NOT NULL,
  at BIGINT NOT NULL,
  actor VARCHAR(100) NOT NULL,
  request_id VARCHAR(100) NULL,
  action VARCHAR(20) NOT NULL,
  note_before VARCHAR(1000) NULL,
  note_after VARCHAR(1000) NULL,
  PRIMARY KEY (id),
  KEY ix_fin_daily_review_log (review_id, id),
  CONSTRAINT fk_fin_daily_review_log FOREIGN KEY (review_id) REFERENCES fin_daily_reviews (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE fin_expense_categories ADD COLUMN is_direct_cost TINYINT(1) NULL;

CREATE INDEX ix_fin_expense_registered ON fin_expenses (registered_at);
