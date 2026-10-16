-- Reversión de 0009_contract_configuration: se pierde la configuración cotizada de los contratos
-- (las versiones conservan su copia en crm_contract_versions.snapshot).
ALTER TABLE crm_contracts DROP COLUMN configuration;
