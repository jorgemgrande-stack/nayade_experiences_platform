-- ─── LEAD SOURCES CATALOG ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS `crm_lead_sources` (
  `id` int AUTO_INCREMENT PRIMARY KEY,
  `code` varchar(50) NOT NULL,
  `name` varchar(100) NOT NULL,
  `description` text,
  `color` varchar(20),
  `icon` varchar(50),
  `sort_order` int DEFAULT 0,
  `is_active` boolean DEFAULT true NOT NULL,
  `is_system` boolean DEFAULT false NOT NULL,
  `created_at` timestamp DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` timestamp DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP NOT NULL,
  UNIQUE KEY `crm_lead_sources_code_unique` (`code`)
);

-- Seed: orígenes de sistema (is_system = true)
INSERT INTO `crm_lead_sources` (`code`, `name`, `description`, `color`, `icon`, `sort_order`, `is_active`, `is_system`) VALUES
  ('LANDING_FORM',       'Formulario web',          'Lead enviado desde el formulario de presupuesto de la landing page', '#3B82F6', 'Globe',        10, true, true),
  ('HOME_FORM',          'Formulario experiencia',  'Lead enviado desde la ficha de experiencia del sitio web',           '#8B5CF6', 'LayoutList',   20, true, true),
  ('GHL_WHATSAPP',       'WhatsApp / GHL',          'Lead captado mediante WhatsApp gestionado por GoHighLevel',          '#22C55E', 'MessageCircle',30, true, true),
  ('VAPI_CALL',          'Llamada IA (Vapi)',        'Lead generado automáticamente por el agente de voz Vapi',            '#F59E0B', 'Phone',        40, true, true),
  ('CRM_MANUAL',         'Alta manual CRM',          'Lead creado directamente por un agente comercial desde el CRM',      '#6B7280', 'UserPlus',     50, true, true),
  ('CHECKOUT_ABANDONED', 'Pago abandonado',          'Lead generado al detectar un carrito con pago fallido o abandonado', '#EF4444', 'ShoppingCart', 60, true, true),
  ('PARTNERS',           'Portal de partners',       'Lead enviado desde el portal de partners o agencias',                '#14B8A6', 'Building2',    70, true, true),
  ('PRESUPUESTO_DIRECTO','Presupuesto directo',      'Lead creado a partir de un presupuesto generado internamente',        '#A855F7', 'FileText',     80, true, true),
  ('REFERIDO',           'Referido / boca a boca',  'Lead referido por un cliente o contacto existente',                  '#EC4899', 'Heart',        90, true, false),
  ('REDES_SOCIALES',     'Redes sociales',           'Lead proveniente de Instagram, Facebook, LinkedIn u otras RRSS',     '#F97316', 'Share2',      100, true, false),
  ('EMAIL_MARKETING',    'Email marketing',          'Lead captado a través de campañas de email marketing',               '#0EA5E9', 'Mail',        110, true, false),
  ('EVENTO_PRESENCIAL',  'Evento presencial',        'Lead conocido en feria, evento o presentación presencial',           '#84CC16', 'Calendar',    120, true, false),
  ('PUBLICIDAD',         'Publicidad (Ads)',         'Lead procedente de campañas de Google Ads, Meta Ads, etc.',          '#F43F5E', 'TrendingUp',  130, true, false),
  ('OTRO',               'Otro',                     'Origen no clasificado en las categorías anteriores',                 '#9CA3AF', 'HelpCircle',  999, true, false);

-- ─── ADD COLUMN TO LEADS ──────────────────────────────────────────────────────
ALTER TABLE `leads` ADD COLUMN IF NOT EXISTS `lead_source_id` int NULL;
ALTER TABLE `leads` ADD INDEX IF NOT EXISTS `idx_leads_lead_source_id` (`lead_source_id`);

-- ─── BACKFILL EXISTING LEADS ──────────────────────────────────────────────────
-- Map legacy source string → new crm_lead_sources.id via subquery

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'LANDING_FORM')
  WHERE `source` IN ('landing_presupuesto', 'web') AND `lead_source_id` IS NULL;

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'HOME_FORM')
  WHERE `source` = 'web_experiencia' AND `lead_source_id` IS NULL;

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'GHL_WHATSAPP')
  WHERE `source` = 'ghl_webhook' AND `lead_source_id` IS NULL;

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'VAPI_CALL')
  WHERE `source` = 'vapi_llamada' AND `lead_source_id` IS NULL;

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'PARTNERS')
  WHERE `source` = 'PARTNER' AND `lead_source_id` IS NULL;

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'PRESUPUESTO_DIRECTO')
  WHERE `source` = 'presupuesto_directo' AND `lead_source_id` IS NULL;

UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'CHECKOUT_ABANDONED')
  WHERE `source` = 'venta_perdida' AND `lead_source_id` IS NULL;

-- Remaining leads without mapping → CRM_MANUAL as fallback
UPDATE `leads` SET `lead_source_id` = (SELECT `id` FROM `crm_lead_sources` WHERE `code` = 'CRM_MANUAL')
  WHERE `lead_source_id` IS NULL;
