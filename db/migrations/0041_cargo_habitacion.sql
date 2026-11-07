-- Big Elephant — cargo a habitación desde Restaurant Net y Care Net al folio de Hotel Net (aditiva, BD de cada empresa;
-- solo actúa con la capacidad hotel-net y la del módulo que carga). Depende de 0034_hotel_folio.
--
-- `hotel_folio_external_charges`: cada cargo que otro módulo hace al folio de una estancia (una comanda, una reserva de
-- SPA o la venta de un bono), con el módulo y la referencia de origen para la trazabilidad, el importe total con IVA y
-- su estado. Sus líneas son movimientos normales de hotel_folio_items (source_key 'ext:<id>:<n>', con el IVA de cada
-- una), así que entran en la factura del folio al cerrarlo. Anular el cargo desde el folio lo marca 'reverted' (no se
-- borra) y devuelve el origen a pendiente de cobro. open_source_key impide que el mismo origen esté cargado dos veces.
--
-- Solo crea una tabla nueva (no modifica ninguna existente). Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS hotel_folio_external_charges (
  id               INT           NOT NULL AUTO_INCREMENT,
  folio_id         INT           NOT NULL,
  reservation_id   INT           NOT NULL,
  source_module    VARCHAR(16)   NOT NULL,
  source_ref       VARCHAR(80)   NOT NULL,
  description      VARCHAR(255)  NULL DEFAULT NULL,
  amount_cents     INT           NOT NULL,
  status           VARCHAR(12)   NOT NULL DEFAULT 'charged',
  created_by       INT           NULL DEFAULT NULL,
  created_at       BIGINT        NOT NULL,
  reverted_by      INT           NULL DEFAULT NULL,
  reverted_at      BIGINT        NULL DEFAULT NULL,
  revert_reason    VARCHAR(255)  NULL DEFAULT NULL,
  open_source_key  VARCHAR(100)  GENERATED ALWAYS AS (IF(status = 'charged', CONCAT(source_module, ':', source_ref), NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_folio_external_open (open_source_key),
  KEY idx_hotel_folio_external_folio (folio_id, status),
  KEY idx_hotel_folio_external_source (source_module, source_ref)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
