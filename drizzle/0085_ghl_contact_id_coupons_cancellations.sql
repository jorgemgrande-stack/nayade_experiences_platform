-- Añadir ghlContactId a coupon_redemptions y cancellation_requests
-- Permite trazar el contacto GHL desde el momento de creación y actualizar
-- tags en cada cambio de estado del pipeline.

ALTER TABLE `coupon_redemptions`
  ADD COLUMN IF NOT EXISTS `ghlContactId` varchar(128);

ALTER TABLE `cancellation_requests`
  ADD COLUMN IF NOT EXISTS `ghl_contact_id` varchar(128);
