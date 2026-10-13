-- ============================================================================
-- Facturación SaaS v1 (plano comercial): suscripciones, facturas, eventos de proveedor.
--
-- BD separada del registro de tenants y de las BD de los tenants. No contiene datos de
-- tarjeta: solo referencias del proveedor de pagos.
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing_subscriptions (
  id         VARCHAR(64)  NOT NULL PRIMARY KEY,
  tenant_id  VARCHAR(63)  NOT NULL,
  status     VARCHAR(20)  NOT NULL,
  period_end TIMESTAMP(3) NOT NULL,
  doc        JSON         NOT NULL,
  UNIQUE KEY uq_subscription_tenant (tenant_id),
  KEY idx_subscription_status_period (status, period_end)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_invoices (
  id        VARCHAR(80)  NOT NULL PRIMARY KEY,
  tenant_id VARCHAR(63)  NOT NULL,
  number    VARCHAR(32)  NOT NULL,
  status    VARCHAR(20)  NOT NULL,
  issued_at TIMESTAMP(3) NOT NULL,
  doc       JSON         NOT NULL,
  UNIQUE KEY uq_invoice_number (number),
  KEY idx_invoice_tenant (tenant_id, issued_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_counters (
  year        INT NOT NULL PRIMARY KEY,
  last_number INT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS billing_events (
  provider_event_id VARCHAR(128) NOT NULL PRIMARY KEY,
  received_at       TIMESTAMP(3) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
