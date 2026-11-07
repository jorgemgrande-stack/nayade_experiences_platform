-- Big Elephant — Restaurant Net · cocina (KDS) y camareros (aditiva, BD de cada empresa; capacidad restaurant-net).
-- Requiere 0033_restaurant_net_sala (comandas y líneas).
--
-- `hospo_kitchen_stations`: partidas de cocina de cada restaurante (cocina, barra, postres…) con su tiempo objetivo
-- (sla_minutes) y su tono de color por significado del panel. Se archivan (is_active = 0), no se borran.
-- `hospo_station_routing`: categoría de la carta → partida (una por categoría y restaurante). Al pedir un plato, su
-- partida es la de su categoría; si no hay enrutado, la del propio plato.
-- `hospo_kds_settings`: semáforo de la pantalla de cocina por restaurante (verde hasta green_max_min minutos desde que
-- se marchó la línea, ámbar hasta amber_max_min, rojo después). Sin fila, 10 y 20 minutos.
-- `hospo_kitchen_incidents`: incidencias de cocina (agotado, devuelto, error de cocina o de sala, rehacer) con la
-- comanda, la línea, el motivo y quién la registró.
-- Los índices de las líneas (marcha, partida y estado) y del camarero de la comanda ya los crea la 0033. Los camareros
-- son usuarios del Core: no hay tabla ni PIN propios.
--
-- Solo crea tablas nuevas (no modifica ninguna existente). Sin la capacidad restaurant-net no se usan. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS hospo_kitchen_stations (
  id             INT          NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)  NULL DEFAULT NULL,
  restaurant_id  INT          NOT NULL,
  name           VARCHAR(40)  NOT NULL,
  tone           VARCHAR(16)  NOT NULL DEFAULT 'neutral',
  sla_minutes    INT          NOT NULL DEFAULT 15,
  sort_order     INT          NOT NULL DEFAULT 0,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     BIGINT       NOT NULL,
  updated_at     BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospo_kitchen_stations_name (restaurant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospo_station_routing (
  id             INT           NOT NULL AUTO_INCREMENT,
  restaurant_id  INT           NOT NULL,
  category       VARCHAR(128)  NOT NULL,
  station        VARCHAR(40)   NOT NULL,
  created_at     BIGINT        NOT NULL,
  updated_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospo_station_routing_category (restaurant_id, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospo_kds_settings (
  id             INT          NOT NULL AUTO_INCREMENT,
  site_id        VARCHAR(63)  NULL DEFAULT NULL,
  restaurant_id  INT          NOT NULL,
  green_max_min  INT          NOT NULL DEFAULT 10,
  amber_max_min  INT          NOT NULL DEFAULT 20,
  updated_by     INT          NULL DEFAULT NULL,
  updated_at     BIGINT       NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hospo_kds_settings_restaurant (restaurant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hospo_kitchen_incidents (
  id             INT           NOT NULL AUTO_INCREMENT,
  restaurant_id  INT           NOT NULL,
  order_id       INT           NOT NULL,
  item_id        INT           NULL DEFAULT NULL,
  type           VARCHAR(20)   NOT NULL,
  reason         VARCHAR(255)  NULL DEFAULT NULL,
  by_user_id     INT           NULL DEFAULT NULL,
  created_at     BIGINT        NOT NULL,
  PRIMARY KEY (id),
  KEY idx_hospo_kitchen_incidents_day (restaurant_id, created_at),
  KEY idx_hospo_kitchen_incidents_order (order_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
