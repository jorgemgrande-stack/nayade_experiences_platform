-- ============================================================================
-- Big Elephant CRM — esquema v1: leads, empresas, contactos, oportunidades, contratos,
-- actividad. BD propia, separada del registro de tenants y de los datos de los clientes.
-- ============================================================================

CREATE TABLE IF NOT EXISTS crm_companies (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(200) NOT NULL,
  tax_id     VARCHAR(40)  NULL,
  website    VARCHAR(300) NULL,
  sector     VARCHAR(100) NULL,
  address    VARCHAR(300) NULL,
  notes      TEXT         NULL,
  tenant_id  VARCHAR(63)  NULL,
  owner      VARCHAR(100) NULL,
  created_at BIGINT       NOT NULL,
  KEY idx_company_name (name),
  UNIQUE KEY uq_company_tenant (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_contacts (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  company_id INT          NULL,
  name       VARCHAR(200) NOT NULL,
  email      VARCHAR(320) NULL,
  phone      VARCHAR(40)  NULL,
  role       VARCHAR(100) NULL,
  created_at BIGINT       NOT NULL,
  KEY idx_contact_company (company_id),
  KEY idx_contact_email (email),
  CONSTRAINT fk_contact_company FOREIGN KEY (company_id) REFERENCES crm_companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_leads (
  id                       INT AUTO_INCREMENT PRIMARY KEY,
  source                   VARCHAR(60)  NULL,
  name                     VARCHAR(200) NOT NULL,
  email                    VARCHAR(320) NULL,
  phone                    VARCHAR(40)  NULL,
  company_name             VARCHAR(200) NULL,
  status                   ENUM('new','contacted','qualified','disqualified','converted') NOT NULL DEFAULT 'new',
  owner                    VARCHAR(100) NULL,
  notes                    TEXT         NULL,
  converted_company_id     INT          NULL,
  converted_opportunity_id INT          NULL,
  created_at               BIGINT       NOT NULL,
  KEY idx_lead_status (status),
  KEY idx_lead_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  company_id     INT          NOT NULL,
  title          VARCHAR(200) NOT NULL,
  stage          ENUM('prospecting','proposal','negotiation','won','lost') NOT NULL DEFAULT 'prospecting',
  amount_cents   BIGINT       NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'EUR',
  expected_close BIGINT       NULL,
  probability    INT          NOT NULL DEFAULT 10,
  owner          VARCHAR(100) NULL,
  lost_reason    VARCHAR(300) NULL,
  created_at     BIGINT       NOT NULL,
  closed_at      BIGINT       NULL,
  KEY idx_opp_stage (stage),
  KEY idx_opp_company (company_id),
  CONSTRAINT fk_opp_company FOREIGN KEY (company_id) REFERENCES crm_companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_contracts (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  company_id     INT          NOT NULL,
  opportunity_id INT          NULL,
  plan_id        VARCHAR(64)  NULL,
  modules        JSON         NOT NULL,
  status         ENUM('draft','sent','signed','active','cancelled') NOT NULL DEFAULT 'draft',
  amount_cents   BIGINT       NULL,
  currency       CHAR(3)      NOT NULL DEFAULT 'EUR',
  start_date     BIGINT       NULL,
  end_date       BIGINT       NULL,
  document_url   VARCHAR(500) NULL,
  signed_at      BIGINT       NULL,
  tenant_id      VARCHAR(63)  NULL,
  created_at     BIGINT       NOT NULL,
  KEY idx_contract_company (company_id),
  KEY idx_contract_status (status),
  CONSTRAINT fk_contract_company FOREIGN KEY (company_id) REFERENCES crm_companies (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_activities (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  entity_type ENUM('lead','company','contact','opportunity','contract') NOT NULL,
  entity_id   INT          NOT NULL,
  kind        ENUM('call','email','meeting','note','task') NOT NULL,
  summary     VARCHAR(1000) NOT NULL,
  due_at      BIGINT       NULL,
  done_at     BIGINT       NULL,
  author      VARCHAR(100) NOT NULL,
  created_at  BIGINT       NOT NULL,
  KEY idx_activity_entity (entity_type, entity_id),
  KEY idx_activity_task (kind, done_at, due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
