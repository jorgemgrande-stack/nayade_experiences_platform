-- Ski Net · Alquiler (módulo del SDK, server/skiRental): activación por sede, material y alquileres.
-- Aditiva y reversible: solo crea tablas nuevas. Desactivar el módulo no borra nada (ski_rental_sites.active = 0).
CREATE TABLE IF NOT EXISTS ski_rental_sites (
  site_id        VARCHAR(63)  NOT NULL,
  active         TINYINT(1)   NOT NULL DEFAULT 1,
  activated_at   TIMESTAMP(3) NULL,
  deactivated_at TIMESTAMP(3) NULL,
  updated_by     VARCHAR(100) NULL,
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_items (
  id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id    VARCHAR(63)  NOT NULL,
  category   VARCHAR(16)  NOT NULL,
  name       VARCHAR(120) NOT NULL,
  size       VARCHAR(16)  NOT NULL DEFAULT '',
  quantity   INT UNSIGNED NOT NULL,
  active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_ski_rental_items_site_item (site_id, category, name, size),
  CONSTRAINT chk_ski_rental_items_category CHECK (category IN ('ski', 'snowboard', 'boots', 'helmet', 'poles', 'other'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS ski_rental_rentals (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  site_id       VARCHAR(63)  NOT NULL,
  item_id       INT UNSIGNED NOT NULL,
  quantity      INT UNSIGNED NOT NULL,
  customer_name VARCHAR(120) NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL,
  status        VARCHAR(16)  NOT NULL DEFAULT 'reserved',
  picked_up_at  TIMESTAMP(3) NULL,
  returned_at   TIMESTAMP(3) NULL,
  cancelled_at  TIMESTAMP(3) NULL,
  created_by    VARCHAR(100) NULL,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  KEY idx_ski_rental_rentals_item_dates (item_id, start_date, end_date),
  KEY idx_ski_rental_rentals_site_status (site_id, status),
  CONSTRAINT fk_ski_rental_rentals_item FOREIGN KEY (item_id) REFERENCES ski_rental_items (id),
  CONSTRAINT chk_ski_rental_rentals_dates CHECK (end_date >= start_date),
  CONSTRAINT chk_ski_rental_rentals_quantity CHECK (quantity > 0),
  CONSTRAINT chk_ski_rental_rentals_status CHECK (status IN ('reserved', 'out', 'returned', 'cancelled'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
