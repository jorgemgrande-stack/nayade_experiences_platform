-- Big Elephant CRM — esquema comercial v2 (aditivo, compatible hacia atrás).
-- Ficha fiscal y de contacto de empresas, contactos completos con contacto principal,
-- prioridad de leads y pipeline ampliado (las etapas existentes se conservan).
-- Aplicar con: MIGRATE_DATABASE_URL=… pnpm exec tsx scripts/db/migrate.ts up --dir db/crm/migrations [--apply]

ALTER TABLE crm_companies
  ADD COLUMN legal_name    VARCHAR(200) NULL AFTER name,
  ADD COLUMN email         VARCHAR(320) NULL,
  ADD COLUMN phone         VARCHAR(40)  NULL,
  ADD COLUMN city          VARCHAR(120) NULL,
  ADD COLUMN postal_code   VARCHAR(20)  NULL,
  ADD COLUMN country       CHAR(2)      NULL,
  ADD COLUMN billing_email VARCHAR(320) NULL,
  ADD COLUMN status        ENUM('active','inactive','churned') NOT NULL DEFAULT 'active',
  ADD COLUMN updated_at    BIGINT       NULL,
  ADD KEY idx_company_status (status),
  ADD KEY idx_company_tax (tax_id);

ALTER TABLE crm_contacts
  ADD COLUMN first_name   VARCHAR(100) NULL AFTER name,
  ADD COLUMN last_name    VARCHAR(150) NULL AFTER first_name,
  ADD COLUMN is_primary   TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN primary_flag TINYINT(1) GENERATED ALWAYS AS (IF(is_primary = 1, 1, NULL)) STORED,
  ADD COLUMN status       ENUM('active','inactive') NOT NULL DEFAULT 'active',
  ADD COLUMN notes        TEXT         NULL,
  ADD COLUMN updated_at   BIGINT       NULL,
  ADD UNIQUE KEY uq_contact_primary (company_id, primary_flag);

ALTER TABLE crm_leads
  ADD COLUMN priority   ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal' AFTER status,
  ADD COLUMN company_id INT    NULL,
  ADD COLUMN updated_at BIGINT NULL,
  ADD KEY idx_lead_phone (phone),
  ADD KEY idx_lead_company (company_id);

ALTER TABLE crm_opportunities
  MODIFY COLUMN stage ENUM('prospecting','contacted','qualification','demo','proposal','negotiation','won','lost') NOT NULL DEFAULT 'prospecting',
  ADD COLUMN contact_id     INT          NULL,
  ADD COLUMN plan_id        VARCHAR(64)  NULL,
  ADD COLUMN modules        JSON         NULL,
  ADD COLUMN next_action    VARCHAR(300) NULL,
  ADD COLUMN next_action_at BIGINT       NULL,
  ADD COLUMN updated_at     BIGINT       NULL,
  ADD KEY idx_opp_owner (owner),
  ADD KEY idx_opp_next (next_action_at);
