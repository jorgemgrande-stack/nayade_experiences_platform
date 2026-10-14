-- Reversión de 0001_crm_commercial_v2. Las etapas nuevas vuelven a la más cercana existente.
UPDATE crm_opportunities SET stage = 'prospecting' WHERE stage IN ('contacted','qualification','demo');

ALTER TABLE crm_opportunities
  DROP KEY idx_opp_next,
  DROP KEY idx_opp_owner,
  DROP COLUMN updated_at,
  DROP COLUMN next_action_at,
  DROP COLUMN next_action,
  DROP COLUMN modules,
  DROP COLUMN plan_id,
  DROP COLUMN contact_id,
  MODIFY COLUMN stage ENUM('prospecting','proposal','negotiation','won','lost') NOT NULL DEFAULT 'prospecting';

ALTER TABLE crm_leads
  DROP KEY idx_lead_company,
  DROP KEY idx_lead_phone,
  DROP COLUMN updated_at,
  DROP COLUMN company_id,
  DROP COLUMN priority;

ALTER TABLE crm_contacts
  DROP KEY uq_contact_primary,
  DROP COLUMN updated_at,
  DROP COLUMN notes,
  DROP COLUMN status,
  DROP COLUMN primary_flag,
  DROP COLUMN is_primary,
  DROP COLUMN last_name,
  DROP COLUMN first_name;

ALTER TABLE crm_companies
  DROP KEY idx_company_tax,
  DROP KEY idx_company_status,
  DROP COLUMN updated_at,
  DROP COLUMN status,
  DROP COLUMN billing_email,
  DROP COLUMN country,
  DROP COLUMN postal_code,
  DROP COLUMN city,
  DROP COLUMN phone,
  DROP COLUMN email,
  DROP COLUMN legal_name;
