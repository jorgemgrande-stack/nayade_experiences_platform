-- Reversión de 0021_vat_checks: borra el registro de comprobaciones en VIES. En live, exportarlo antes: es la prueba
-- de la diligencia debida de cada inversión del sujeto pasivo aplicada.
DROP TABLE stripe_vat_checks;
