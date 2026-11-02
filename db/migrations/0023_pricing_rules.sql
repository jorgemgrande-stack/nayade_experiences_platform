-- Big Elephant — Reglas de precios de la empresa (aditiva, BD de cada empresa; capacidad Business pricing-rules).
--
-- `pricing_rules`: descuentos y recargos que la empresa aplica a sus productos (porcentaje o importe fijo por unidad),
-- con prioridad (1 = primera), vigencia, ámbito (todo el catálogo, productos o categorías), cantidad mínima, días de la
-- semana, franja de fechas del servicio, canales (web, tpv, presupuesto) y si se acumula con otras reglas acumulables.
-- Las listas se guardan como texto separado por comas.
--
-- Solo crea una tabla nueva: no cambia productos, pedidos, ventas, presupuestos ni facturas. Sin reglas el cálculo de
-- precios es el de siempre. Las empresas Essential no la usan. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS pricing_rules (
  id            INT           NOT NULL AUTO_INCREMENT,
  name          VARCHAR(80)   NOT NULL,
  active        TINYINT(1)    NOT NULL DEFAULT 1,
  priority      INT           NOT NULL DEFAULT 0,
  kind          VARCHAR(16)   NOT NULL DEFAULT 'descuento',
  value_type    VARCHAR(16)   NOT NULL DEFAULT 'porcentaje',
  value         DECIMAL(10,2) NOT NULL DEFAULT 0,
  scope         VARCHAR(16)   NOT NULL DEFAULT 'todo',
  target_ids    TEXT          NULL,
  min_quantity  INT           NOT NULL DEFAULT 1,
  weekdays      VARCHAR(16)   NULL DEFAULT NULL,
  channels      VARCHAR(64)   NOT NULL DEFAULT 'web,tpv,presupuesto',
  valid_from    DATE          NULL DEFAULT NULL,
  valid_to      DATE          NULL DEFAULT NULL,
  service_from  DATE          NULL DEFAULT NULL,
  service_to    DATE          NULL DEFAULT NULL,
  combinable    TINYINT(1)    NOT NULL DEFAULT 0,
  created_at    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_pricing_rules_priority (active, priority)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
