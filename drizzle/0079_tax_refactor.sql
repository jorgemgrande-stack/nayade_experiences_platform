-- ─── 0079: Refactor fiscal — separar fiscalRegime de taxRate ────────────────
-- Nuevo modelo: fiscalRegime = "general" | "reav" | "mixed"
--               taxRate = número independiente (21, 10, ...)
-- "general_21" queda obsoleto; coerción lazy en backend para datos legacy.

-- ─── 1. ENUM: experiences ────────────────────────────────────────────────────
ALTER TABLE `experiences`
  ADD COLUMN IF NOT EXISTS `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00,
  MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `experiences` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 2. ENUM: packs ──────────────────────────────────────────────────────────
ALTER TABLE `packs`
  ADD COLUMN IF NOT EXISTS `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00,
  MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `packs` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 3. ENUM: room_types ─────────────────────────────────────────────────────
ALTER TABLE `room_types`
  ADD COLUMN IF NOT EXISTS `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00,
  MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `room_types` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 4. ENUM: spa_treatments ─────────────────────────────────────────────────
ALTER TABLE `spa_treatments`
  ADD COLUMN IF NOT EXISTS `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 21.00,
  MODIFY COLUMN `fiscalRegime` ENUM('reav','general','mixed') NOT NULL DEFAULT 'general';
--> statement-breakpoint
UPDATE `spa_treatments` SET `fiscalRegime` = 'general' WHERE `fiscalRegime` = 'general_21';
--> statement-breakpoint

-- ─── 5. ENUM: tpv_sale_items (columna fiscalRegime_tsi) ──────────────────────
ALTER TABLE `tpv_sale_items`
  MODIFY COLUMN `fiscalRegime_tsi` ENUM('reav','general','mixed') DEFAULT 'general';
--> statement-breakpoint
UPDATE `tpv_sale_items` SET `fiscalRegime_tsi` = 'general' WHERE `fiscalRegime_tsi` = 'general_21';
--> statement-breakpoint

-- ─── 6. ENUM + taxRate: transactions (columna fiscalRegime_tx) ───────────────
ALTER TABLE `transactions`
  ADD COLUMN IF NOT EXISTS `taxRate_tx` DECIMAL(5,2) DEFAULT 21.00,
  MODIFY COLUMN `fiscalRegime_tx` ENUM('reav','general','mixed') DEFAULT 'general';
--> statement-breakpoint
UPDATE `transactions` SET `fiscalRegime_tx` = 'general' WHERE `fiscalRegime_tx` = 'general_21';
--> statement-breakpoint
UPDATE `transactions` SET `taxRate_tx` = 21 WHERE `taxRate_tx` IS NULL AND `fiscalRegime_tx` = 'general';
--> statement-breakpoint

-- ─── 7. taxBreakdown JSON en invoices ────────────────────────────────────────
-- taxRate se conserva para retrocompatibilidad con facturas antiguas.
ALTER TABLE `invoices`
  ADD COLUMN IF NOT EXISTS `taxBreakdown` JSON NULL;
--> statement-breakpoint
