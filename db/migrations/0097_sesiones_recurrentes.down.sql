-- Reversión de 0097 sin perder datos: las tablas se RENOMBRAN (se conservan las ofertas y los derechos de participación).
-- Antes se quitan sus restricciones CHECK (el nombre de una CHECK es único en toda la base y bloquearía volver a aplicar la 0097);
-- quitar una restricción no borra ninguna fila.
ALTER TABLE recurring_session_offers DROP CHECK chk_recurring_offer_weekday;
ALTER TABLE recurring_session_entitlements DROP CHECK chk_recurring_entitlement_status;
ALTER TABLE recurring_session_entitlements DROP CHECK chk_recurring_entitlement_notice;
ALTER TABLE recurring_session_entitlements DROP CHECK chk_recurring_entitlement_zoom;
RENAME TABLE recurring_session_offers TO retired_recurring_session_offers,
             recurring_session_entitlements TO retired_recurring_session_entitlements;
