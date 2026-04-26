INSERT IGNORE INTO `system_settings` (`key`, `value`, `value_type`, `category`, `label`, `description`, `is_sensitive`, `is_public`) VALUES
  ('brand_logo_url', 'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_blue_e9563f49.png', 'string', 'branding', 'URL del logo', 'URL del logo principal usado en emails y documentos', false, true),
  ('brand_hero_image_url', 'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade_lago_aereo_178815fc.jpg', 'string', 'branding', 'URL imagen hero emails', 'URL de la imagen de cabecera usada en plantillas de email', false, true),
  ('brand_primary_color', '#0a1628', 'string', 'branding', 'Color primario (hex)', 'Color primario de marca en formato hexadecimal', false, true),
  ('brand_accent_color', '#f97316', 'string', 'branding', 'Color de acento (hex)', 'Color de acento/naranja de marca en formato hexadecimal', false, true),
  ('brand_website_url', 'https://nayadeexperiences.es', 'string', 'branding', 'URL de la web', 'URL principal de la web pública', false, true),
  ('brand_support_phone', '+34 930 34 77 91', 'string', 'branding', 'Teléfono de soporte', 'Teléfono visible en emails al cliente para consultas', false, true),
  ('brand_location', 'Los Ángeles de San Rafael, Segovia', 'string', 'branding', 'Ubicación visible', 'Ubicación mostrada en emails y documentos', false, true);
