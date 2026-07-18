-- El TPV permite vender Lego Packs (server/routers/tpv.ts: createSale acepta
-- productType="legoPack" en las líneas), pero el enum de la columna
-- `productType_tsi` en `tpv_sale_items` nunca incluyó ese valor. El INSERT
-- de la línea de venta falla cuando el carrito contiene un Lego Pack: la
-- venta principal ya quedó insertada en `tpv_sales` (status='pending') y
-- el fallo posterior deja la venta huérfana en ese estado.
--
-- Añadimos 'legoPack' al enum existente. Solo amplía los valores válidos,
-- no toca datos existentes.
--
-- Migración idempotente: ver scripts/apply-tpv-sale-items-legopack-enum.cjs

ALTER TABLE `tpv_sale_items`
  MODIFY COLUMN `productType_tsi` ENUM('experience','pack','spa','hotel','restaurant','extra','legoPack') NOT NULL;
