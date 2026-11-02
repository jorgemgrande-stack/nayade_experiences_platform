-- Big Elephant — Embudo de ventas configurable del CRM (aditiva, BD de cada empresa; capacidad Business crm-funnel-advanced).
--
-- `crm_funnel_stages`: etapas del embudo de la empresa (nombre, orden, probabilidad, tipo abierta/ganada/perdida y color
-- semántico). `legacy_status` liga las cuatro etapas por defecto con el estado de siempre de las oportunidades
-- (leads.opportunityStatus): nueva, enviada, ganada y perdida. Las crea la aplicación la primera vez que se usa el embudo.
-- `crm_lead_stages`: etapa elegida en el embudo para cada oportunidad. Sin fila, la etapa se deriva de su estado.
--
-- Solo crea tablas nuevas: no cambia ni rellena las oportunidades. Las empresas Essential no las usan. Nunca se ejecuta
-- al arrancar.

CREATE TABLE IF NOT EXISTS crm_funnel_stages (
  id             INT          NOT NULL AUTO_INCREMENT,
  name           VARCHAR(80)  NOT NULL,
  position       INT          NOT NULL DEFAULT 0,
  probability    TINYINT UNSIGNED NOT NULL DEFAULT 0,
  kind           VARCHAR(16)  NOT NULL DEFAULT 'abierta',
  color          VARCHAR(16)  NOT NULL DEFAULT 'gris',
  legacy_status  VARCHAR(16)  NULL DEFAULT NULL,
  created_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_crm_funnel_stages_legacy (legacy_status),
  KEY idx_crm_funnel_stages_position (position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS crm_lead_stages (
  lead_id    INT          NOT NULL,
  stage_id   INT          NOT NULL,
  moved_by   INT          NULL DEFAULT NULL,
  moved_at   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (lead_id),
  KEY idx_crm_lead_stages_stage (stage_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
