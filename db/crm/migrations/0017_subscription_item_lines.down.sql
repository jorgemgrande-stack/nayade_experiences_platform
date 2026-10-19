-- Reversión de 0017_subscription_item_lines: quita el tipo de partida y la métrica (se pueden deducir del
-- catálogo). No borra partidas ni cambia cantidades ni vigencias.
ALTER TABLE subscription_items DROP CHECK chk_item_quantity_metric, DROP COLUMN metric, DROP COLUMN line_kind;
