-- Reversión de 0071: los productos «precio visible, solo por solicitud» pasan a «bajo petición» (dejan de mostrar el precio, siguen sin poder comprarse) y se retira el valor.
UPDATE experiences SET offer_mode = 'on_request' WHERE offer_mode = 'priced_request';
ALTER TABLE experiences
  MODIFY COLUMN offer_mode ENUM('fixed','on_request','coming_soon') NOT NULL DEFAULT 'fixed';
