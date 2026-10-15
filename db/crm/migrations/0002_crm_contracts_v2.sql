-- Big Elephant CRM — contratos SaaS v2 (aditivo, compatible hacia atrás).
-- Referencia única, condiciones comerciales, periodicidad, renovación, versionado inmutable y
-- campos preparados para una futura firma electrónica (no se implementa firma ficticia).

ALTER TABLE crm_contracts
  ADD COLUMN reference            VARCHAR(32)  NULL AFTER id,
  ADD COLUMN conditions           TEXT         NULL,
  ADD COLUMN billing_interval     ENUM('month','year') NULL,
  ADD COLUMN renewal_date         BIGINT       NULL,
  ADD COLUMN auto_renew           TINYINT(1)   NOT NULL DEFAULT 0,
  ADD COLUMN notice_days          INT          NULL,
  ADD COLUMN version              INT          NOT NULL DEFAULT 1,
  ADD COLUMN previous_contract_id INT          NULL,
  ADD COLUMN signature_method     ENUM('manual','electronic') NULL,
  ADD COLUMN signature_ref        VARCHAR(200) NULL,
  ADD COLUMN updated_at           BIGINT       NULL,
  ADD UNIQUE KEY uq_contract_reference (reference),
  ADD KEY idx_contract_renewal (renewal_date),
  ADD KEY idx_contract_previous (previous_contract_id);

-- Relleno de los contratos existentes con la MISMA regla que el código (contractReference):
-- CT-<año UTC de created_at>-<id con al menos 6 dígitos, sin truncar>. Solo toca referencias NULL.
-- DATE_ADD sobre una fecha literal no depende de la zona horaria de la sesión.
UPDATE crm_contracts
   SET reference = CONCAT('CT-', YEAR(DATE_ADD('1970-01-01', INTERVAL FLOOR(created_at / 1000) SECOND)), '-', LPAD(id, GREATEST(6, CHAR_LENGTH(id)), '0'))
 WHERE reference IS NULL;

CREATE TABLE IF NOT EXISTS crm_contract_versions (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  contract_id INT          NOT NULL,
  version     INT          NOT NULL,
  snapshot    JSON         NOT NULL,
  reason      VARCHAR(300) NULL,
  author      VARCHAR(100) NOT NULL,
  created_at  BIGINT       NOT NULL,
  UNIQUE KEY uq_contract_version (contract_id, version),
  CONSTRAINT fk_version_contract FOREIGN KEY (contract_id) REFERENCES crm_contracts (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
