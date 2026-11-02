-- Reversión de 0021_crm_funnel_stages: se pierden las etapas propias del embudo y la etapa elegida de cada oportunidad
-- (las oportunidades y su estado de siempre se conservan). Antes, desplegar el código anterior al embudo configurable.
DROP TABLE IF EXISTS crm_lead_stages;
DROP TABLE IF EXISTS crm_funnel_stages;
