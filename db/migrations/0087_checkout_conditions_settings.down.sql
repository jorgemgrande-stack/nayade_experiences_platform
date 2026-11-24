-- Reversión de 0087_checkout_conditions_settings.sql: quita solo esos cinco ajustes (el pago vuelve a no exigir nada).
DELETE FROM system_settings WHERE `key` IN ('checkout_terms_url', 'checkout_privacy_url', 'checkout_cancellation_url', 'checkout_consent_required', 'checkout_participants_enabled');
