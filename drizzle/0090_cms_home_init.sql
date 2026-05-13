-- Seed: página "Inicio" en el CMS con todos sus bloques representando la home actual.
-- La home pública (/) sigue siendo hardcodeada en React — este seed es solo para
-- que el editor admin tenga el contenido documentado y editable en el CMS.

-- 1. Crear o actualizar la página "inicio"
INSERT INTO static_pages (slug, title, metaTitle, metaDescription, isPublished)
VALUES (
  'inicio',
  'Inicio — Náyade Experiences',
  'Náyade Experiences | Actividades acuáticas, Hotel y SPA en el Lago de Bolarque',
  'Experiencias acuáticas, hotel con vistas al lago, SPA y packs personalizados a 40 min de Madrid. Temporada Abril — Octubre 2026.',
  1
)
ON DUPLICATE KEY UPDATE
  title         = VALUES(title),
  metaTitle     = VALUES(metaTitle),
  metaDescription = VALUES(metaDescription),
  isPublished   = VALUES(isPublished);

-- 2. Limpiar bloques anteriores (si los hay) para inserción limpia
DELETE FROM page_blocks WHERE pageSlug = 'inicio';

-- 3. Insertar bloques en orden

-- Bloque 1: Hero principal
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'hero', 1,
  '{"title":"Diseñamos tu experiencia perfecta","subtitle":"Actividades acuáticas, relax, escapadas y aventura en el embalse de Los Angeles de San Rafael. A 40 min de Madrid.","imageUrl":"https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/embalse-verano_64368cd4.jpg","ctaText":"Solicitar Presupuesto","ctaUrl":"/presupuesto","overlayOpacity":55}',
  1
);

-- Bloque 2: Razones para elegirnos (features)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'features', 2,
  '{"title":"Por que Nayade Experiences","items":[{"icon":"📍","title":"A 45 min de Madrid","description":"Acceso directo por la AP-6"},{"icon":"🌊","title":"+10 Actividades","description":"El mayor catalogo acuatico de la Sierra"},{"icon":"❤️","title":"Hotel + SPA + Lago","description":"Todo en un mismo enclave"},{"icon":"🌿","title":"Entorno Natural Unico","description":"Sierra de Guadarrama a 1.200 m"},{"icon":"👥","title":"Para Todos","description":"Familias, parejas, grupos y empresas"},{"icon":"🛡️","title":"Monitores Certificados","description":"Seguridad y profesionalidad"},{"icon":"📅","title":"Reserva Online 24h","description":"Descuento del 10% online"},{"icon":"⚡","title":"Packs Personalizados","description":"A medida para cada grupo"}]}',
  1
);

-- Bloque 3: Actividades acuáticas (image + text)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'image_text', 3,
  '{"title":"Actividades Acuaticas","body":"Blob Jump, Banana Ski, Cableski, Kayak, Paddle Surf, Hidrobicis, Aventura Hinchable y mucho mas. Mas de 10 actividades en el lago para todos los niveles y edades. Reserva online con un 10% de descuento.","imageUrl":"https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg","imagePosition":"right","ctaText":"Ver todas las experiencias","ctaUrl":"/experiencias"}',
  1
);

-- Bloque 4: Lego Packs (image + text)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'image_text', 4,
  '{"title":"Lego Packs — Tu experiencia a medida","body":"Combina actividades, almuerzo y acceso al club en un Lego Pack personalizado. Disponibles para dias sueltos, escapadas en pareja, excursiones escolares, teambuilding de empresa y packs con alojamiento incluido.","imageUrl":"https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/kayak-grupo_b3eca02d.jpg","imagePosition":"left","ctaText":"Ver Lego Packs","ctaUrl":"/lego-packs"}',
  1
);

-- Bloque 5: Hotel (image + text)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'image_text', 5,
  '{"title":"Hotel Nayade — Vistas al Lago","body":"Alojate en el corazon de la naturaleza con vistas directas al embalse. Habitaciones desde 130 EUR/noche. Habitacion Doble Estandar, Superior, Familiar y Junior Suite Premium. Packs con actividades incluidas con descuento.","imageUrl":"https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/d049863d-3421-411f-a64f-64eb34408da9_145ab8b4.png","imagePosition":"right","ctaText":"Ver Hotel","ctaUrl":"/hotel"}',
  1
);

-- Bloque 6: SPA (image + text)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'image_text', 6,
  '{"title":"SPA y Bienestar","body":"Circuito SPA, masajes relajantes, tratamientos faciales y packs especiales para parejas. El complemento perfecto para tu estancia en el lago. Reserva por separado o combinado con Hotel.","imageUrl":"https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa4_0e502ffb.png","imagePosition":"left","ctaText":"Ver SPA","ctaUrl":"/spa"}',
  1
);

-- Bloque 7: Galería de actividades
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'gallery', 7,
  '{"title":"Descubre Nayade","images":["https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/blob-jump2_94e0b06d.jpg","https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/cableski_53f05d4a.jpg","https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/canoa-lago_b18c5886.jpg","https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/paddle-surf_78ab1b6f.jpg","https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/banana-ski_43cb68d6.jpg","https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/spa2_f1c857bc.png"]}',
  1
);

-- Bloque 8: Testimonios (accordion = desplegables por review)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'accordion', 8,
  '{"title":"Lo que dicen nuestros clientes","items":[{"question":"Maria G. — Familia · Madrid ★★★★★","answer":"Una experiencia increible para toda la familia. Los ninos no paraban de hablar del Blob Jump durante semanas. El hotel es precioso y el personal muy atento."},{"question":"Carlos M. — Empresa · Barcelona ★★★★★","answer":"Organizamos el team building de empresa aqui y fue un exito total. Las actividades de cableski y la gymkhana acuatica superaron todas las expectativas del equipo."},{"question":"Laura y Javi — Pareja · Segovia ★★★★★","answer":"El fin de semana romantico fue perfecto. Actividades de dia, spa por la tarde y cena con vistas al lago. No podiamos pedir mas. Volveremos sin duda."}]}',
  1
);

-- Bloque 9: Módulo Canjea tu Cupón (CTA)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'cta', 9,
  '{"title":"Tienes un Cupon Regalo o Voucher?","subtitle":"Canjea tu experiencia de Groupon, Wonderbox, El Corte Ingles o LetsBonus de forma rapida y sencilla. Rellena el formulario online, adjunta tu cupon y nuestro equipo te confirmara fecha y detalles en menos de 24h.","ctaText":"Canjear mi Cupon Ahora","ctaUrl":"/canjear-cupon","bgColor":"dark"}',
  1
);

-- Bloque 10: Módulo Colegios y Campamentos (CTA)
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'cta', 10,
  '{"title":"Colegios, AMPAs y Campamentos","subtitle":"Disenamos programas educativos y de aventura para grupos escolares en el Lago de Bolarque. Seguridad certificada, monitores titulados y actividades adaptadas a cada edad. Presupuesto gratuito en menos de 24h.","ctaText":"Solicitar Programa Escolar","ctaUrl":"/colegios","bgColor":"dark"}',
  1
);

-- Bloque 11: CTA Final
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'cta', 11,
  '{"title":"Listo para Vivir la Aventura?","subtitle":"Reserva online con un 10% de descuento. Temporada Abril — Octubre 2026.","ctaText":"Explorar Experiencias","ctaUrl":"/experiencias","bgColor":"orange"}',
  1
);

-- Bloque 12: Separador final
INSERT INTO page_blocks (pageSlug, blockType, sortOrder, data, isVisible) VALUES (
  'inicio', 'spacer', 12,
  '{"height":40}',
  1
);
