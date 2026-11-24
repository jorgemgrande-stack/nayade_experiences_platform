-- Reversión de 0086: se retiran los límites (todas las opciones vuelven a admitir cualquier número de participantes).
ALTER TABLE experience_variants DROP COLUMN maxQty;
ALTER TABLE experience_variants DROP COLUMN minQty;
