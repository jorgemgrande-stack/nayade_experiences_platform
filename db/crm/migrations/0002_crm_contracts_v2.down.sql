-- Reversión de 0002_crm_contracts_v2 (se pierde el historial de versiones de contratos).
DROP TABLE IF EXISTS crm_contract_versions;

ALTER TABLE crm_contracts
  DROP KEY idx_contract_previous,
  DROP KEY idx_contract_renewal,
  DROP KEY uq_contract_reference,
  DROP COLUMN updated_at,
  DROP COLUMN signature_ref,
  DROP COLUMN signature_method,
  DROP COLUMN previous_contract_id,
  DROP COLUMN version,
  DROP COLUMN notice_days,
  DROP COLUMN auto_renew,
  DROP COLUMN renewal_date,
  DROP COLUMN billing_interval,
  DROP COLUMN conditions,
  DROP COLUMN reference;
