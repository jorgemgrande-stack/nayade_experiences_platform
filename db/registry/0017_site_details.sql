-- Elephant Source — datos de contacto de cada sede (aditiva).
--   tenant_site_details: dirección, teléfono y correo de una sede del registro (tenant_sites), editables por la propia
--     empresa desde su panel (capacidad Business `multi-site`). Tabla aparte: tenant_sites no cambia y una sede sin
--     fila aquí simplemente no tiene datos de contacto.
-- Solo crea una tabla nueva y vacía. Repetible (IF NOT EXISTS).
-- Reversión: 0017_site_details.down.sql (elimina los datos de contacto de las sedes: exportar antes si hay filas).

CREATE TABLE IF NOT EXISTS tenant_site_details (
  tenant_id   VARCHAR(63)  NOT NULL,
  site_id     VARCHAR(63)  NOT NULL,
  address     VARCHAR(300) NULL,
  phone       VARCHAR(40)  NULL,
  email       VARCHAR(200) NULL,
  updated_at  BIGINT       NOT NULL,
  updated_by  VARCHAR(100) NOT NULL,
  PRIMARY KEY (tenant_id, site_id),
  CONSTRAINT fk_site_details_site FOREIGN KEY (tenant_id, site_id) REFERENCES tenant_sites (tenant_id, site_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- El marcador de versión (registry_meta) lo fija el aplicador tras verificar las tablas: sin UPDATE aquí.
