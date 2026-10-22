-- Big Elephant — domicilio de facturación del comprador (aditiva). El perfil fiscal (0014) guarda país y código
-- postal; con esta columna guarda también la calle, la ciudad y la provincia o región declaradas. Con ellas el
-- Customer de Stripe se crea con la dirección comprobada antes del pago y Checkout no la deja cambiar (el
-- impuesto se calcula sobre la dirección que pasó el control de elegibilidad). NULL en los perfiles anteriores.
-- Nunca se ejecuta al arrancar; sin ella el plano de control funciona igual (Checkout pide la dirección como
-- hasta ahora). Diseño: server/stripe/eligibility.ts y docs/elephant-source/MATRIZ_FISCAL_INTERNACIONAL.md.

ALTER TABLE stripe_buyer_profiles
  ADD COLUMN billing_address_json JSON NULL AFTER contact_name;
