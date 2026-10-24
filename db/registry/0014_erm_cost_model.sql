-- Elephant Source — tarifas del Resource Manager editables y auditadas (aditiva).
--   erm_cost_model: el modelo de costes VIGENTE (una fila) que se edita desde Admin, con versión para evitar que dos
--     personas se pisen. Sin fila, el coste sale de ERM_COST_MODEL o de la estimación con precios públicos (declarada).
--   erm_cost_model_history: cada cambio, con la versión, el modelo completo, el motivo, quién y cuándo.
-- Solo tarifas internas de coste: ni precios de venta ni cobros (eso es de la ventana de Stripe).

CREATE TABLE IF NOT EXISTS erm_cost_model (
  id          TINYINT      NOT NULL,
  version     INT          NOT NULL,
  model_json  TEXT         NOT NULL,
  updated_by  VARCHAR(100) NOT NULL,
  updated_at  BIGINT       NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT chk_erm_cost_model_single CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS erm_cost_model_history (
  id          BIGINT       NOT NULL AUTO_INCREMENT,
  version     INT          NOT NULL,
  model_json  TEXT         NOT NULL,
  reason      VARCHAR(300) NOT NULL,
  changed_by  VARCHAR(100) NOT NULL,
  changed_at  BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_erm_cost_model_history_version (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

UPDATE registry_meta SET v = '0014' WHERE k = 'schema_version';
