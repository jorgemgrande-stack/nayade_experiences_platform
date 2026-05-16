-- Fix: 0092 dejó concept_text sin crear porque Drizzle no soporta varios
-- ; separados sin --> statement-breakpoint. Esta migración asegura ambas
-- columnas vía IF NOT EXISTS — segura aunque la 0092 sí las hubiera creado.
ALTER TABLE `tpv_sale_items`
  ADD COLUMN IF NOT EXISTS `is_manual` tinyint(1) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `concept_text` varchar(500) DEFAULT NULL;
