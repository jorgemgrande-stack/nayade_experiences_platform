-- Big Elephant — Hotel Net · folio de estancia, cierre del día e informes (aditiva, BD de cada empresa; solo actúa con
-- la capacidad hotel-net). Depende de 0032_hotel_pms.
--
-- `hotel_pms_settings`: ajustes del PMS de la empresa (una fila, id = 1): IVA del alojamiento en puntos básicos
-- (1000 = 10 %). Sin fila, el 10 %.
-- `hotel_folios`: cuenta de la estancia, una por reserva (reservation_id único). Abierta mientras se cargan consumos y
-- se registran pagos; al cerrarla se emite la factura con la numeración de facturas de la empresa (invoice_id).
-- `hotel_folio_items`: cargos (alojamiento por noche, extras) y pagos del folio. Importes en céntimos con IVA incluido.
-- source_key (único por folio) hace idempotentes los cargos automáticos: la noche de alojamiento o el pago previo de la
-- reserva nunca se cargan dos veces.
-- `hotel_night_audit`: cierre del día por sede (site_id NULL = principal; site_key '' para la principal, único con la
-- fecha): llegadas, salidas, alojados, no-shows, ocupación, ingresos de alojamiento, ADR y RevPAR.
--
-- Solo crea tablas nuevas y vacías. Nunca se ejecuta al arrancar.

CREATE TABLE IF NOT EXISTS hotel_pms_settings (
  id                    TINYINT       NOT NULL,
  accommodation_tax_bp  INT           NOT NULL DEFAULT 1000,
  updated_by            INT           NULL DEFAULT NULL,
  updated_at            BIGINT        NOT NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_folios (
  id              INT           NOT NULL AUTO_INCREMENT,
  reservation_id  INT           NOT NULL,
  status          VARCHAR(12)   NOT NULL DEFAULT 'abierto',
  invoice_id      INT           NULL DEFAULT NULL,
  invoice_number  VARCHAR(32)   NULL DEFAULT NULL,
  closed_at       BIGINT        NULL DEFAULT NULL,
  closed_by       INT           NULL DEFAULT NULL,
  created_at      BIGINT        NOT NULL,
  updated_at      BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_folios_reservation (reservation_id),
  KEY idx_hotel_folios_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_folio_items (
  id                BIGINT        NOT NULL AUTO_INCREMENT,
  folio_id          INT           NOT NULL,
  kind              VARCHAR(8)    NOT NULL,
  category          VARCHAR(24)   NOT NULL,
  description       VARCHAR(255)  NULL DEFAULT NULL,
  quantity          INT           NOT NULL DEFAULT 1,
  unit_price_cents  INT           NOT NULL DEFAULT 0,
  amount_cents      INT           NOT NULL,
  tax_rate_bp       INT           NULL DEFAULT NULL,
  night_date        VARCHAR(10)   NULL DEFAULT NULL,
  source_key        VARCHAR(64)   NULL DEFAULT NULL,
  created_by        INT           NULL DEFAULT NULL,
  created_at        BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_folio_items_source (folio_id, source_key),
  KEY idx_hotel_folio_items_folio (folio_id, kind)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS hotel_night_audit (
  id                  INT           NOT NULL AUTO_INCREMENT,
  site_id             VARCHAR(63)   NULL DEFAULT NULL,
  site_key            VARCHAR(63)   GENERATED ALWAYS AS (IFNULL(site_id, '')) STORED NOT NULL,
  business_date       VARCHAR(10)   NOT NULL,
  arrivals            INT           NOT NULL DEFAULT 0,
  departures          INT           NOT NULL DEFAULT 0,
  in_house            INT           NOT NULL DEFAULT 0,
  no_shows            INT           NOT NULL DEFAULT 0,
  rooms_occupied      INT           NOT NULL DEFAULT 0,
  capacity            INT           NOT NULL DEFAULT 0,
  occupancy_bp        INT           NOT NULL DEFAULT 0,
  room_revenue_cents  BIGINT        NOT NULL DEFAULT 0,
  adr_cents           INT           NOT NULL DEFAULT 0,
  revpar_cents        INT           NOT NULL DEFAULT 0,
  source              VARCHAR(12)   NOT NULL DEFAULT 'manual',
  ran_by              INT           NULL DEFAULT NULL,
  ran_at              BIGINT        NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_hotel_night_audit_site_date (site_key, business_date),
  KEY idx_hotel_night_audit_date (business_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
