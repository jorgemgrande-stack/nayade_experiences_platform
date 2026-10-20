-- Reversión de 0020_buyer_billing_address: quita el domicilio de facturación del perfil del comprador. El resto
-- del perfil y su historial (que conserva la dirección en cada instantánea) no se tocan.
ALTER TABLE stripe_buyer_profiles DROP COLUMN billing_address_json;
