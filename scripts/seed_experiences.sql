-- ============================================================
-- SEED: Restauración de experiencias Náyade
-- Ejecutar: railway connect mysql < scripts/seed_experiences.sql
-- O pegar en la sesión interactiva de railway connect mysql
-- ============================================================

SET NAMES utf8mb4;

-- ── 1. CATEGORÍAS (INSERT IGNORE = no rompe si ya existen) ──────────────────
INSERT IGNORE INTO categories (slug, name, isActive, sortOrder)
VALUES
  ('actividades-acuaticas', 'Actividades Acuáticas', 1, 1),
  ('deportes-acuaticos',    'Deportes Acuáticos',    1, 2),
  ('spa-bienestar',         'SPA & Bienestar',        1, 3),
  ('piscina',               'Piscina & Baño',         1, 4);

-- ── 2. UBICACIÓN ─────────────────────────────────────────────────────────────
INSERT IGNORE INTO locations (slug, name, address, isActive, sortOrder)
VALUES
  ('los-angeles-de-san-rafael',
   'Los Ángeles de San Rafael',
   'Club Náutico Los Ángeles de San Rafael, Segovia',
   1, 1);

-- ── 3. EXPERIENCIAS ──────────────────────────────────────────────────────────
-- Usamos subqueries para categoryId y locationId para mayor seguridad

-- 1. Paseo en Barco
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'paseo-en-barco',
  'Paseo en Barco',
  'Navega por las tranquilas aguas del embalse de Los Ángeles de San Rafael rodeado de vegetación y vistas panorámicas.',
  'Una experiencia única surcando las apacibles aguas del embalse de Los Ángeles de San Rafael. A bordo disfrutarás de paisajes de ensueño, rodeado de vegetación frondosa y con las cumbres de la Sierra de Guadarrama como telón de fondo. Ideal para familias, parejas y grupos que buscan una actividad tranquila y memorable.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775049168929-vx1e7i.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775049168929-vx1e7i.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775049603095-8rkwvh.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775049607679-rxudag.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775049612665-6ts80x.png',
  '15.00', '20 minutos', 1, 50,
  'facil', 0, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Seguro de accidentes"]',
  '[]',
  'general_21', 'actividad', 'per_person', 1
);

-- 2. Entrada General Piscina
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'entrada-general-piscina-club-nautico',
  'Entrada General Piscina Club Náutico',
  'Relájate y diviértete en nuestra piscina a orillas del embalse con amplias zonas de baño y solárium.',
  'Disfruta de la piscina del Club Náutico de Los Ángeles de San Rafael, situada a orillas del embalse con impresionantes vistas a la Sierra de Guadarrama. Cuenta con amplias zonas de solárium, acceso al lago y todas las comodidades para una jornada de descanso y recreo en familia o con amigos.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774281603494-er84vo.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774281603494-er84vo.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774281608106-4fqd45.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1774281619410-lefaql.png',
  NULL,
  '7.00', NULL, 11, 100,
  'facil', 0, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'piscina'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Acceso a las instalaciones", "Seguro de accidentes"]',
  '["Acceso a Bahía VIP"]',
  'general_21', 'actividad', 'per_person', 2
);

-- 3. Alquiler Día Completo Tabla de Wakeboard
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'alquiler-dia-completo-tabla-de-wakeboard',
  'Alquiler Día Completo Tabla de Wakeboard',
  'Alquila tu tabla de wakeboard para todo el día y disfruta del embalse a tu ritmo combinando velocidad, equilibrio y emociones acuáticas.',
  'Vive la experiencia del wakeboard durante un día completo en el embalse de Los Ángeles de San Rafael. Ya seas principiante o experto, la tabla de wakeboard te permitirá deslizarte sobre el agua combinando velocidad, equilibrio y adrenalina en un entorno natural inigualable. Mínimo 2 personas.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775074493261-jccylv.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775074493261-jccylv.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775074605323-iygad1.webp',
  NULL,
  '45.00', '1 día', 1, 5,
  'facil', 0, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'deportes-acuaticos'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Tabla de wakeboard", "Fijaciones/herrajes", "Chaleco salvavidas", "Seguro de accidentes"]',
  '["Neopreno"]',
  'general_21', 'actividad', 'per_person', 3
);

-- 4. Cableski & Wakeboard
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'cableski-wakeboard',
  'Cableski & Wakeboard',
  'El sistema de cable aéreo continuo te propulsará sobre el agua haciendo wakeboard o esquí acuático. ¡Una experiencia que engancha desde la primera vuelta!',
  'El cableski de Náyade te permite practicar wakeboard o esquí acuático impulsado por un sistema de cable aéreo continuo, sin necesidad de lancha motora. No hace falta experiencia previa: el cable hace el trabajo y tú solo tienes que dejarte llevar. Disponible por vueltas o en formato media jornada/jornada completa.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773766863713-7gry6r.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773766863713-7gry6r.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773766869680-r66be7.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773766880496-2l6cdm.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773766883661-g2yblj.png',
  '30.00', NULL, 1, 100,
  'moderado', 0, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'deportes-acuaticos'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Esquís, mono-ski o kneeboard", "Chaleco salvavidas/protector", "Seguro de accidentes"]',
  '["Tabla de wakeboard", "Neopreno"]',
  'general_21', 'actividad', 'per_person', 4
);

-- 5. Blob Jump
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'blob-jump',
  'Blob Jump',
  'Lánzate desde una plataforma elevada sobre un giant blob inflable y sal despedido al aire antes de caer al lago. ¡La actividad más adrenalínica del verano!',
  'El Blob Jump es la actividad más impactante de Náyade. Te lanzas desde una plataforma elevada sobre un enorme colchón inflable (blob) situado en el agua, que propulsa al compañero que está en el extremo opuesto por los aires antes de caer al embalse. Pura adrenalina para los más valientes. Disponible por saltos individuales o en bonos de 3 y 5 saltos.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773762402377-dymd02.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773762402377-dymd02.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773762413686-d56xu2.png',
  '8.00', NULL, 1, 20,
  'dificil', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Equipo protector (parachoques)", "Seguro de accidentes", "Chaleco salvavidas"]',
  '["Casco"]',
  'general_21', 'actividad', 'per_person', 5
);

-- 6. Canoas & Kayaks
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'canoas-kayaks',
  'Canoas & Kayaks',
  'Explora el embalse en canoa o kayak a tu propio ritmo. Una actividad que combina deporte, paisaje y tranquilidad con vistas a la Sierra de Guadarrama.',
  'Navega por el embalse de Los Ángeles de San Rafael en canoa o kayak y descubre rincones únicos a tu propio ritmo. Una actividad perfecta para todos los niveles que combina ejercicio suave, contacto con la naturaleza y unas vistas espectaculares de la Sierra de Guadarrama. Disponible en alquiler de 1, 2 o 3 horas, y con Fórmula Familiar para 4 personas.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775063728570-x1kzd8.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775063728570-x1kzd8.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775063736967-y2tlnu.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775063750522-nke2gs.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775063846540-gcz3jp.png',
  '12.00', '1 hora', 2, 4,
  'facil', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Embarcación para 2 pasajeros", "Remos para 2 personas", "Chaleco salvavidas", "Seguro de accidentes"]',
  '["Bolsa impermeable"]',
  'general_21', 'actividad', 'per_person', 6
);

-- 7. Paddle Surf
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'paddle-surf',
  'Paddle Surf',
  'Practica el stand-up paddleboarding en las tranquilas aguas del embalse. Equilibrio, calma y diversión para todos los niveles.',
  'El Paddle Surf o Stand-Up Paddleboarding (SUP) es una actividad perfecta para disfrutar del embalse de una manera activa y serena. De pie sobre la tabla, remando con una pala, podrás explorar las orillas del embalse y disfrutar de las vistas. Accesible para principiantes y apto para toda la familia. Disponible en sesiones de 1 hora, 2 horas o Fórmula Familiar.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773774376430-cmec06.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773774376430-cmec06.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773774379647-stk79l.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773774382023-qz52s0.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773774392088-2ldmdb.jpg',
  '20.00', '1 hora', 1, 6,
  'facil', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Tabla individual", "Remo/pala", "Chaleco salvavidas", "Seguro de accidentes"]',
  '["Bolsa estanca impermeable"]',
  'general_21', 'actividad', 'per_person', 7
);

-- 8. Donuts Ski (clon con slug largo)
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'banana-ski-donuts-copia-dRMV',
  'Donuts Ski',
  'La actividad más divertida para grupos: flota sobre un donut inflable remolcado por una lancha motora a alta velocidad, con giros inesperados y salpicones garantizados.',
  'El Donuts Ski es, sin duda, la actividad más divertida y apta para todos los públicos de Náyade. Subidos en un flotador circular de goma inflable, serás remolcado por una lancha motora a alta velocidad por las aguas del embalse. Giros inesperados, saltos, curvas pronunciadas y salpicones constantes hacen de esta actividad una experiencia de risa garantizada. Disponible para grupos de 2 a 8 personas.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773863507321-ywvj6b.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773863507321-ywvj6b.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1775034710820-bwhf5y.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702422261-h5ajd3.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702434768-wegear.png',
  '35.00', '20 minutos', 2, 8,
  'moderado', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Equipo y flotador", "Chaleco salvavidas", "Seguro de accidentes"]',
  '["Neopreno"]',
  'general_21', 'actividad', 'per_person', 8
);

-- 9. Circuito SPA Hidrotermal
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'circuito-spa',
  'Circuito SPA Hidrotermal',
  'Circuito hidrotérmico completo con piscinas a distintas temperaturas, jacuzzi, sauna finlandesa, baño turco y duchas de contraste. La experiencia de bienestar definitiva.',
  'El Circuito SPA Hidrotermal de Náyade te ofrece una experiencia de bienestar completa en un entorno privilegiado. El circuito incluye piscinas a diferentes temperaturas, chorros cervicales y lumbares, sauna finlandesa, baño turco y duchas de contraste. Perfecto para desconectar, recuperarte y mimar tu cuerpo. Disponible con precio especial para clientes del hotel.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773867774581-gde9k3.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773867774581-gde9k3.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773867780249-4it3ac.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773867847070-xh6y0d.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773867967358-gmcgyp.png',
  '18.00', NULL, 6, 20,
  'facil', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'spa-bienestar'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Acceso a todo el circuito hidrotermal", "Piscinas a distintas temperaturas", "Sauna finlandesa", "Baño turco", "Duchas de contraste", "Seguro de accidentes"]',
  '[]',
  'general_21', 'actividad', 'per_person', 9
);

-- 10. Banana Ski
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3, image4,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'banana-ski-donuts',
  'Banana Ski',
  'La actividad más divertida y apta para todos los públicos: sentados en el flotador en forma de banana o donut, la lancha motora os arrastrará a alta velocidad por el embalse.',
  'El Banana Ski es la actividad más divertida y popular de Náyade, ideal para grupos y familias. Sentados en un flotador en forma de banana o donut, la lancha motora os remolcará a alta velocidad por las aguas del embalse. Risas, emociones y salpicones están garantizados. Mínimo 4 personas para la tarifa estándar.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702396972-kd9hrk.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702396972-kd9hrk.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702409563-u54xhb.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702422261-h5ajd3.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773702434768-wegear.png',
  '15.00', '20 minutos', 4, 8,
  'moderado', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Seguro de accidentes"]',
  '[]',
  'general_21', 'actividad', 'per_person', 10
);

-- 11. Hidrobicis (Hidropedales)
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'hidropedales',
  'Hidrobicis',
  'Pedalea sobre el agua y explora el embalse a tu ritmo. Una actividad tranquila y relajante perfecta para toda la familia.',
  'Las hidrobicis (o hidropedales) son la opción perfecta para disfrutar del embalse de forma relajada y sin esfuerzo. Pedaleando sobre el agua podrás explorar los rincones más tranquilos del embalse, disfrutar de las vistas y descansar. Ideal para familias con niños y para quienes buscan una actividad sin adrenalina. Disponible en sesiones de 1 hora, 2 horas o Fórmula Familiar.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773777174336-io6lvw.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773777174336-io6lvw.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773777177100-p1hzuw.jpg',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773777198906-716boe.png',
  '20.00', '1 hora', 2, 4,
  'moderado', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Hidropedal", "Chaleco salvavidas", "Seguro de accidentes"]',
  '["Neopreno"]',
  'general_21', 'actividad', 'per_person', 11
);

-- 12. Aventura Hinchable Acuática
INSERT IGNORE INTO experiences
  (slug, title, shortDescription, description,
   coverImageUrl, image1, image2, image3,
   basePrice, duration, minPersons, maxPersons,
   difficulty, isFeatured, isActive, isPublished, isPresentialSale,
   categoryId, locationId,
   includes, excludes,
   fiscalRegime, productType, pricing_type, sortOrder)
VALUES (
  'aventura-hinchable',
  'Aventura Hinchable Acuática',
  'Parque inflable flotante en el lago con toboganes, trampolines y circuitos de obstáculos. ¡Diversión garantizada para todas las edades!',
  'La Aventura Hinchable Acuática es el parque de atracciones flotante de Náyade: un enorme recorrido inflable situado en el embalse con toboganes, trampolines, muros de escalada y circuitos de obstáculos para superar. Diversión y risas garantizadas para toda la familia. Especialmente indicado para niños, pero igualmente divertido para adultos. Disponible en sesiones de 30 y 60 minutos.',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773778862239-e30o1s.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773778862239-e30o1s.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773778867350-w70k1r.png',
  'https://d2xsxph8kpxj0f.cloudfront.net/310519663410228097/AV298FS8t5SaTurBBRqhgQ/nayade/uploads/1773779017020-g7xxyf.png',
  '8.00', '1 hora', 1, 30,
  'facil', 1, 1, 1, 1,
  (SELECT id FROM categories WHERE slug = 'actividades-acuaticas'),
  (SELECT id FROM locations  WHERE slug = 'los-angeles-de-san-rafael'),
  '["Seguro de accidentes"]',
  '[]',
  'general_21', 'actividad', 'per_person', 12
);

-- ── Verificación ─────────────────────────────────────────────────────────────
SELECT id, slug, title, basePrice, isActive, isPublished
FROM experiences
ORDER BY sortOrder;
