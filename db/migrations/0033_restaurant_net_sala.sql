-- Big Elephant — Restaurant Net · sala, carta y comandas (aditiva, BD de cada empresa; capacidad restaurant-net).
--
-- `dining_rooms`: salas de cada restaurante (salón, terraza, barra…). Se archivan (is_active = 0), no se borran.
-- `dining_tables`: mesas de una sala con su posición en el plano (pos_x/pos_y/width/height, en puntos del plano de
-- 1000×640) y la unión de mesas (merged_into = mesa principal; la comanda vive en la principal). El estado
-- (libre, ocupada, pide la cuenta) no se guarda: se deriva de las comandas abiertas.
-- `restaurant_menu_items`: carta de cada restaurante (categoría, precio con IVA incluido, tipo de IVA, alérgenos,
-- partida e imagen opcional). Se archivan (is_active = 0): las ventas ya cobradas siguen apuntando a su plato.
-- `hospo_orders`: comandas (una por mesa abierta). subtotal = base imponible y total = importe con IVA de las líneas
-- no anuladas. Estados: open, bill_requested (pide la cuenta), paying (cobro en curso en el TPV), paid y cancelled
-- (cerrada sin cobro). open_table_key es la barrera de una sola comanda abierta por mesa (índice único).
-- tpv_sale_id enlaza la venta del TPV del Core que la cobró (el cobro y la factura son siempre los del TPV); site_id
-- es la sede de la caja que cobró (NULL = principal).
-- `hospo_order_items`: líneas de comanda con la foto del plato (nombre, precio e IVA al pedirlo), partida, pase,
-- comensal, estado (las anuladas guardan el motivo) y los tiempos de cocina para el KDS futuro.
-- `restaurant_booking_tables`: mesas asignadas a una reserva de restaurante (una reserva puede ocupar varias).
-- `restaurant_bookings.seated_at` / `hospo_order_id`: cuándo se sentó la reserva y la comanda que abrió.
--
-- Solo crea tablas nuevas y añade dos columnas nulas. Sin la capacidad restaurant-net no se usan. Nunca se ejecuta al
-- arrancar.

CREATE TABLE IF NOT EXISTS dining_rooms (
  id             INT           NOT NULL AUTO_INCREMENT,
  restaurant_id  INT           NOT NULL,
  name           VARCHAR(120)  NOT NULL,
  kind           VARCHAR(16)   NOT NULL DEFAULT 'salon',
  sort_order     INT           NOT NULL DEFAULT 0,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_dining_rooms_restaurant (restaurant_id, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS dining_tables (
  id             INT           NOT NULL AUTO_INCREMENT,
  room_id        INT           NOT NULL,
  restaurant_id  INT           NOT NULL,
  code           VARCHAR(40)   NOT NULL,
  shape          VARCHAR(12)   NOT NULL DEFAULT 'square',
  capacity       INT           NOT NULL DEFAULT 4,
  pos_x          INT           NOT NULL DEFAULT 0,
  pos_y          INT           NOT NULL DEFAULT 0,
  width          INT           NOT NULL DEFAULT 80,
  height         INT           NOT NULL DEFAULT 80,
  merged_into    INT           NULL DEFAULT NULL,
  is_active      TINYINT(1)    NOT NULL DEFAULT 1,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_dining_tables_code (restaurant_id, code),
  KEY idx_dining_tables_room (room_id),
  KEY idx_dining_tables_merged (merged_into)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS restaurant_menu_items (
  id             INT            NOT NULL AUTO_INCREMENT,
  restaurant_id  INT            NOT NULL,
  name           VARCHAR(256)   NOT NULL,
  description    VARCHAR(512)   NULL DEFAULT NULL,
  category       VARCHAR(128)   NULL DEFAULT NULL,
  price          DECIMAL(10,2)  NOT NULL DEFAULT 0,
  tax_rate       DECIMAL(5,2)   NOT NULL DEFAULT 10,
  image_url      TEXT           NULL,
  allergens      JSON           NULL,
  station        VARCHAR(40)    NULL DEFAULT NULL,
  is_active      TINYINT(1)     NOT NULL DEFAULT 1,
  sort_order     INT            NOT NULL DEFAULT 0,
  created_at     BIGINT         NOT NULL,
  updated_at     BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_restaurant_menu_items_restaurant (restaurant_id, is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospo_orders (
  id                     INT            NOT NULL AUTO_INCREMENT,
  site_id                VARCHAR(63)    NULL DEFAULT NULL,
  restaurant_id          INT            NOT NULL,
  table_id               INT            NULL DEFAULT NULL,
  waiter_user_id         INT            NULL DEFAULT NULL,
  status                 VARCHAR(16)    NOT NULL DEFAULT 'open',
  guests                 INT            NOT NULL DEFAULT 1,
  customer_name          VARCHAR(255)   NULL DEFAULT NULL,
  order_type             VARCHAR(16)    NOT NULL DEFAULT 'dine_in',
  priority               VARCHAR(8)     NOT NULL DEFAULT 'normal',
  restaurant_booking_id  INT            NULL DEFAULT NULL,
  tpv_sale_id            INT            NULL DEFAULT NULL,
  subtotal               DECIMAL(10,2)  NOT NULL DEFAULT 0,
  total                  DECIMAL(10,2)  NOT NULL DEFAULT 0,
  notes                  TEXT           NULL,
  opened_at              BIGINT         NOT NULL,
  closed_at              BIGINT         NULL DEFAULT NULL,
  open_table_key         INT GENERATED ALWAYS AS (IF(status IN ('open', 'bill_requested', 'paying'), table_id, NULL)) STORED,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospo_orders_open_table (open_table_key),
  KEY idx_hospo_orders_restaurant (restaurant_id, status),
  KEY idx_hospo_orders_table (table_id),
  KEY idx_hospo_orders_sale (tpv_sale_id),
  KEY idx_hospo_orders_booking (restaurant_booking_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospo_order_items (
  id               INT            NOT NULL AUTO_INCREMENT,
  order_id         INT            NOT NULL,
  product_type     VARCHAR(16)    NOT NULL DEFAULT 'restaurant',
  product_id       INT            NULL DEFAULT NULL,
  name             VARCHAR(300)   NOT NULL,
  quantity         INT            NOT NULL DEFAULT 1,
  unit_price       DECIMAL(10,2)  NOT NULL,
  tax_rate         DECIMAL(5,2)   NOT NULL DEFAULT 10,
  station          VARCHAR(40)    NULL DEFAULT NULL,
  course           INT            NOT NULL DEFAULT 1,
  seat             INT            NULL DEFAULT NULL,
  status           VARCHAR(12)    NOT NULL DEFAULT 'pending',
  notes            VARCHAR(500)   NULL DEFAULT NULL,
  void_reason      VARCHAR(255)   NULL DEFAULT NULL,
  voided_by        INT            NULL DEFAULT NULL,
  fired_at         BIGINT         NULL DEFAULT NULL,
  prep_started_at  BIGINT         NULL DEFAULT NULL,
  ready_at         BIGINT         NULL DEFAULT NULL,
  served_at        BIGINT         NULL DEFAULT NULL,
  created_at       BIGINT         NOT NULL,
  updated_at       BIGINT         NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hospo_order_items_order (order_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS restaurant_booking_tables (
  id          INT     NOT NULL AUTO_INCREMENT,
  booking_id  INT     NOT NULL,
  table_id    INT     NOT NULL,
  created_at  BIGINT  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_restaurant_booking_tables (booking_id, table_id),
  KEY idx_restaurant_booking_tables_table (table_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE restaurant_bookings
  ADD COLUMN seated_at BIGINT NULL DEFAULT NULL,
  ADD COLUMN hospo_order_id INT NULL DEFAULT NULL;
