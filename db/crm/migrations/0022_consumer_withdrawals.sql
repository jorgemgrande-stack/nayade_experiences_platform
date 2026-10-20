-- Big Elephant — desistimiento de consumidores (aditiva). Cada solicitud (desde la cuenta del cliente o registrada
-- por soporte) con su referencia de justificante, fecha y hora, quién la presenta, la evaluación del plazo y de sus
-- efectos (propuesta, nunca un reembolso), el estado de la resolución y la resolución. El historial guarda cada paso.
-- Una solicitud abierta como mucho por contrato (columna generada única) y la misma petición una sola vez (clave
-- de idempotencia). Nunca se ejecuta al arrancar; sin estas tablas la función de desistimiento no se monta.
-- Diseño: server/withdrawals/.

CREATE TABLE consumer_withdrawals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  livemode TINYINT(1) NOT NULL DEFAULT 0,
  reference VARCHAR(32) NOT NULL,
  idempotency_key VARCHAR(100) NOT NULL,
  order_id INT NOT NULL,
  contract_order_id INT NOT NULL,
  company_id INT NOT NULL,
  tenant_id VARCHAR(64) NULL,
  channel ENUM('platform','support') NOT NULL,
  requested_by VARCHAR(120) NOT NULL,
  contact_email VARCHAR(200) NOT NULL,
  statement VARCHAR(1000) NULL,
  requested_at BIGINT NOT NULL,
  deadline_at BIGINT NULL,
  within_term TINYINT(1) NOT NULL,
  assessment_json JSON NOT NULL,
  status ENUM('received','under_review','accepted','rejected','completed') NOT NULL DEFAULT 'received',
  resolution_json JSON NULL,
  receipt_sent_at BIGINT NULL,
  version INT NOT NULL DEFAULT 1,
  updated_at BIGINT NOT NULL,
  open_contract INT GENERATED ALWAYS AS (IF(status IN ('received','under_review','accepted'), contract_order_id, NULL)) STORED,
  UNIQUE KEY uq_withdrawal_reference (reference),
  UNIQUE KEY uq_withdrawal_key (livemode, idempotency_key),
  UNIQUE KEY uq_withdrawal_open (livemode, open_contract),
  KEY idx_withdrawal_status (livemode, status, id),
  CONSTRAINT fk_withdrawal_order FOREIGN KEY (order_id) REFERENCES commercial_orders (id),
  CONSTRAINT fk_withdrawal_contract FOREIGN KEY (contract_order_id) REFERENCES commercial_orders (id),
  CONSTRAINT chk_withdrawal_livemode CHECK (livemode IN (0,1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE consumer_withdrawal_events (
  id INT AUTO_INCREMENT PRIMARY KEY,
  withdrawal_id INT NOT NULL,
  action VARCHAR(30) NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  actor VARCHAR(120) NOT NULL,
  note VARCHAR(1000) NULL,
  at BIGINT NOT NULL,
  KEY idx_withdrawal_events (withdrawal_id, id),
  CONSTRAINT fk_withdrawal_event FOREIGN KEY (withdrawal_id) REFERENCES consumer_withdrawals (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
