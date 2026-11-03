-- Big Elephant — Inventario y existencias (aditiva, BD de cada empresa; capacidad Business inventory-basic).
--
-- `inventory_items`: productos (o variantes) del catálogo marcados como inventariables, con su política de venta sin
-- existencias ('block' bloquea, 'allow' permite con aviso) y su mínimo de alerta. variant_id = 0: el producto entero.
-- `inventory_levels`: existencias de cada artículo por sede (site_id NULL = sede principal; site_key es su clave única).
-- `inventory_movements`: historial auditable de entradas, ventas, devoluciones, ajustes y traspasos (cantidad con signo,
-- existencias después, motivo, documento origen, usuario y fecha). idem_key única: un mismo documento nunca se aplica
-- dos veces (cobro repetido, notificación de pago duplicada o doble clic en el panel).
-- `reservations.stock_variant_id`: variante elegida en la tienda online para descontar sus existencias al cobrar.
--
-- Solo crea tablas nuevas y añade una columna nula. Sin artículos inventariables (Essential y quien no lo use) nada
-- cambia. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS inventory_items (
  id               INT          NOT NULL AUTO_INCREMENT,
  product_id       INT          NOT NULL,
  variant_id       INT          NOT NULL DEFAULT 0,
  tracked          TINYINT(1)   NOT NULL DEFAULT 1,
  oversell_policy  VARCHAR(16)  NOT NULL DEFAULT 'block',
  min_stock        INT          NOT NULL DEFAULT 0,
  created_at       BIGINT       NOT NULL,
  updated_at       BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_items_product (product_id, variant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_levels (
  id          INT          NOT NULL AUTO_INCREMENT,
  item_id     INT          NOT NULL,
  site_id     VARCHAR(63)  NULL DEFAULT NULL,
  site_key    VARCHAR(63)  AS (IFNULL(site_id, '')) STORED NOT NULL,
  on_hand     INT          NOT NULL DEFAULT 0,
  min_stock   INT          NULL DEFAULT NULL,
  updated_at  BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_levels_site (item_id, site_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS inventory_movements (
  id             BIGINT        NOT NULL AUTO_INCREMENT,
  item_id        INT           NOT NULL,
  product_id     INT           NOT NULL,
  variant_id     INT           NOT NULL DEFAULT 0,
  site_id        VARCHAR(63)   NULL DEFAULT NULL,
  kind           VARCHAR(24)   NOT NULL,
  quantity       INT           NOT NULL,
  balance_after  INT           NULL DEFAULT NULL,
  shortfall      TINYINT(1)    NOT NULL DEFAULT 0,
  reason         VARCHAR(300)  NULL DEFAULT NULL,
  source_type    VARCHAR(24)   NULL DEFAULT NULL,
  source_id      VARCHAR(64)   NULL DEFAULT NULL,
  source_ref     VARCHAR(100)  NULL DEFAULT NULL,
  reverses_id    BIGINT        NULL DEFAULT NULL,
  idem_key       VARCHAR(160)  NULL DEFAULT NULL,
  user_id        INT           NULL DEFAULT NULL,
  user_name      VARCHAR(200)  NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_inventory_movements_idem (idem_key),
  KEY idx_inventory_movements_item (item_id, created_at),
  KEY idx_inventory_movements_source (source_type, source_id),
  KEY idx_inventory_movements_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE reservations
  ADD COLUMN stock_variant_id INT NULL DEFAULT NULL;
