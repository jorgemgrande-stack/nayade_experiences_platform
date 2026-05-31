-- 0120_reservations_channel_normalize.sql
--
-- Normaliza el enum `reservations.channel` eliminando los valores legacy.
-- Tras esta migración el enum solo contiene la taxonomía moderna (10 valores).
--
-- IMPORTANTE: MySQL ENUM compara case-insensitive, así que 'telefono' y
-- 'TELEFONO' chocarían si coexistieran en el enum. El plan se hace en
-- 3 fases para evitar esa colisión.
--
-- Mapeo legacy -> moderno:
--   web      -> ONLINE_DIRECTO
--   crm      -> VENTA_DELEGADA
--   telefono -> VENTA_DELEGADA  (channel_detail preserva 'telefono')
--   email    -> VENTA_DELEGADA  (channel_detail preserva 'email')
--   otro     -> MANUAL
--   tpv      -> TPV_FISICO
--   groupon  -> PARTNER  (+ platform_name='Groupon' si null)
--
-- IMPORTANTE: este SQL es declarativo. El despliegue real se hace con
-- scripts/apply-reservations-channel-normalize.cjs (idempotente).

-- ── FASE 1: preservar info en channel_detail ─────────────────────────
UPDATE `reservations` SET `channel_detail` = 'telefono'
 WHERE `channel` = 'telefono' AND (`channel_detail` IS NULL OR `channel_detail` = '');
UPDATE `reservations` SET `channel_detail` = 'email'
 WHERE `channel` = 'email'    AND (`channel_detail` IS NULL OR `channel_detail` = '');

-- ── FASE 2: UPDATE legacy → moderno (al enum actual) ─────────────────
UPDATE `reservations` SET `channel` = 'ONLINE_DIRECTO'  WHERE `channel` = 'web';
UPDATE `reservations` SET `channel` = 'VENTA_DELEGADA'  WHERE `channel` IN ('crm','telefono','email');
UPDATE `reservations` SET `channel` = 'MANUAL'          WHERE `channel` = 'otro';
UPDATE `reservations` SET `channel` = 'TPV_FISICO'      WHERE `channel` = 'tpv';
UPDATE `reservations`
   SET `channel` = 'PARTNER',
       `platform_name` = COALESCE(`platform_name`, 'Groupon')
 WHERE `channel` = 'groupon';

-- ── FASE 3: ALTER enum a la taxonomía limpia (10 valores) ────────────
-- Como los legacy ya no están en uso, podemos eliminarlos y añadir
-- los nuevos TELEFONO/EMAIL en el mismo ALTER sin colisión.
ALTER TABLE `reservations` MODIFY COLUMN `channel` ENUM(
  'ONLINE_DIRECTO','ONLINE_ASISTIDO','VENTA_DELEGADA','TELEFONO','EMAIL',
  'TPV_FISICO','PARTNER','TICKETING','MANUAL','API'
) DEFAULT 'ONLINE_DIRECTO';
