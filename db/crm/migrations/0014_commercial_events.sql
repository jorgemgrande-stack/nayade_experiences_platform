-- Big Elephant — registro central de eventos comerciales (aditiva). Una fila por hecho del circuito
-- comercial: prueba, pedido, suscripción, cobro, impago, renovación, cambio de plan, módulos,
-- cancelación y reembolso. La escribe cada almacén en la MISMA transacción que su cambio de estado
-- (patrón transactional outbox); `dispatch_status` queda para el futuro despachador de notificaciones.
-- Sin datos personales: solo identificadores, importes, claves de catálogo y estados.
-- Nunca se ejecuta al arrancar. Comparte número con 0014 del PR #153 (abierto): el que se fusione
-- después se renumera (0015/0016) antes de aplicarse en ninguna BD.
-- Diseño: docs/elephant-source/EVENTOS_COMERCIALES.md.

CREATE TABLE commercial_events (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  -- Idempotencia: el mismo hecho nunca se registra dos veces (agregado + versión o estado alcanzado)
  event_key VARCHAR(160) NOT NULL,
  type VARCHAR(60) NOT NULL,
  schema_version SMALLINT NOT NULL,
  -- Entorno comercial que lo escribió: «test» (integración, pruebas) o «live». El registro se niega a
  -- montarse si encuentra filas del otro entorno.
  environment ENUM('test','live') NOT NULL,
  source ENUM('system','operator','customer','stripe') NOT NULL,
  actor VARCHAR(100) NOT NULL,
  tenant_id VARCHAR(63) NULL,
  company_id INT NULL,
  -- Operación de punta a punta (order:N, trial:N, subscription:N) y causa (p. ej. stripe:evt_…)
  correlation_id VARCHAR(40) NOT NULL,
  causation_id VARCHAR(120) NULL,
  aggregate_type ENUM('order','payment','trial','subscription','charge') NOT NULL,
  aggregate_id VARCHAR(80) NOT NULL,
  -- Versión del agregado tras el cambio: ordena los hechos de un mismo agregado y delata huecos
  aggregate_version INT NULL,
  order_id INT NULL,
  subscription_id INT NULL,
  trial_id INT NULL,
  payment_id INT NULL,
  -- Objeto de Stripe relacionado (inv:…, ch_…), si lo hay
  stripe_ref VARCHAR(120) NULL,
  from_state VARCHAR(30) NULL,
  to_state VARCHAR(30) NULL,
  data_json JSON NULL,
  occurred_at BIGINT NOT NULL,
  dispatch_status ENUM('pending','done','skipped','dead') NOT NULL DEFAULT 'pending',
  dispatch_attempts INT NOT NULL DEFAULT 0,
  next_attempt_at BIGINT NULL,
  UNIQUE KEY uq_commercial_event_key (event_key),
  KEY ix_commercial_event_correlation (correlation_id, id),
  KEY ix_commercial_event_tenant (tenant_id, id),
  KEY ix_commercial_event_company (company_id, id),
  KEY ix_commercial_event_order (order_id, id),
  KEY ix_commercial_event_type (type, occurred_at),
  KEY ix_commercial_event_aggregate (aggregate_type, aggregate_id, aggregate_version),
  KEY ix_commercial_event_dispatch (dispatch_status, next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
