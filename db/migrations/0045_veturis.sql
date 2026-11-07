-- Elephant Connect · Veturis para Travel Net (server/travelNet/veturis): ajustes por empresa (reserva real e inventario,
-- los dos apagados por defecto), hoteles de Veturis con los que trabaja la empresa y la oferta de Veturis de cada
-- servicio de alojamiento de un expediente (con su neto, su revalidación y, si se reserva, el localizador). Las
-- credenciales van en la bóveda (proveedor veturis). Solo CREATE TABLE.
CREATE TABLE IF NOT EXISTS travel_veturis_settings (
  id                TINYINT UNSIGNED NOT NULL,
  supplier_id       INT          NULL,
  booking_enabled   TINYINT(1)   NOT NULL DEFAULT 0,
  inventory_enabled TINYINT(1)   NOT NULL DEFAULT 0,
  updated_by        INT          NULL,
  updated_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  CONSTRAINT chk_travel_veturis_settings_singleton CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_veturis_hotels (
  id              INT UNSIGNED NOT NULL AUTO_INCREMENT,
  hotel_id        VARCHAR(12)  NOT NULL,
  name            VARCHAR(200) NOT NULL,
  destination     VARCHAR(120) NULL,
  active          TINYINT(1)   NOT NULL DEFAULT 1,
  last_checked_at TIMESTAMP(3) NULL,
  last_available  TINYINT(1)   NULL,
  last_error      VARCHAR(300) NULL,
  created_by      INT          NULL,
  created_at      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_travel_veturis_hotels_hotel (hotel_id),
  KEY idx_travel_veturis_hotels_active (active, last_checked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS travel_veturis_offers (
  id                 INT UNSIGNED NOT NULL AUTO_INCREMENT,
  service_id         INT          NOT NULL,
  file_id            INT          NOT NULL,
  hotel_id           VARCHAR(12)  NOT NULL,
  hotel_name         VARCHAR(200) NOT NULL,
  room_name          VARCHAR(200) NOT NULL,
  board_name         VARCHAR(120) NULL,
  check_in           DATE         NOT NULL,
  check_out          DATE         NOT NULL,
  rooms              JSON         NOT NULL,
  search_obj         VARCHAR(200) NOT NULL,
  offer_token        VARCHAR(300) NOT NULL,
  net_cents          INT UNSIGNED NOT NULL,
  currency           CHAR(3)      NOT NULL DEFAULT 'EUR',
  refundable         VARCHAR(8)   NOT NULL DEFAULT 'unknown',
  cancellation       JSON         NULL,
  environment        VARCHAR(8)   NOT NULL,
  status             VARCHAR(12)  NOT NULL DEFAULT 'quoted',
  booking_id         VARCHAR(40)  NULL,
  security_code      VARCHAR(64)  NULL,
  locator            VARCHAR(40)  NULL,
  last_error         VARCHAR(500) NULL,
  revalidated_at     TIMESTAMP(3) NULL,
  previous_net_cents INT UNSIGNED NULL,
  created_by         INT          NULL,
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_travel_veturis_offers_service (service_id),
  KEY idx_travel_veturis_offers_file (file_id),
  KEY idx_travel_veturis_offers_status (status),
  CONSTRAINT chk_travel_veturis_offers_status CHECK (status IN ('quoted', 'booking', 'booked', 'doubtful', 'failed')),
  CONSTRAINT chk_travel_veturis_offers_env CHECK (environment IN ('test', 'live'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
