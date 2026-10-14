-- ============================================================================
-- Registro de tenants — esquema v1.6.0: tickets de soporte (plano comercial)
-- Cada ticket pertenece a UN tenant (tenant_id obligatorio); las consultas siempre filtran por él.
-- ============================================================================

CREATE TABLE IF NOT EXISTS support_tickets (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  tenant_id    VARCHAR(63)  NOT NULL,
  title        VARCHAR(200) NOT NULL,
  description  TEXT         NOT NULL,
  category     VARCHAR(40)  NOT NULL DEFAULT 'general',
  priority     ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  status       ENUM('open','in_progress','waiting_customer','resolved','closed') NOT NULL DEFAULT 'open',
  requester    VARCHAR(200) NULL,
  assignee     VARCHAR(100) NULL,
  created_by   VARCHAR(100) NOT NULL,
  created_at   BIGINT       NOT NULL,
  updated_at   BIGINT       NOT NULL,
  resolved_at  BIGINT       NULL,
  KEY idx_ticket_tenant (tenant_id, status, updated_at),
  KEY idx_ticket_status (status, priority, updated_at),
  KEY idx_ticket_assignee (assignee, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS support_ticket_events (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  ticket_id  INT          NOT NULL,
  at         BIGINT       NOT NULL,
  actor      VARCHAR(100) NOT NULL,
  kind       ENUM('created','status','priority','assignee','comment') NOT NULL,
  from_value VARCHAR(200) NULL,
  to_value   VARCHAR(200) NULL,
  comment    TEXT         NULL,
  internal   TINYINT(1)   NOT NULL DEFAULT 0,
  KEY idx_ticket_event (ticket_id, at),
  CONSTRAINT fk_ticket_event FOREIGN KEY (ticket_id) REFERENCES support_tickets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0006' WHERE k = 'schema_version';
