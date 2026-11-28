-- Newsletter · listas por idioma, importación histórica y audiencias de Elephant Campaigns (orden de Dirección, Quantum
-- Soulrise; reutilizable por todas las empresas). Aditiva: columnas nuevas con valor por defecto, una tabla nueva y el
-- CHECK de estado sustituido por otro con un nombre nuevo (el nombre de una CHECK es único en toda la base).
--
-- newsletter_subscribers:
--   signup_locale  idioma de la web desde la que la persona se inscribió la PRIMERA vez (no cambia después).
--                  Se rellena con el idioma actual en las filas existentes.
--   locale_source  de dónde sale el idioma actual: 'web' (clasificación por la web de alta), 'subscriber' (la propia
--                  persona al volver a inscribirse pendiente), 'admin' (cambiado en el panel) o 'import' (fichero histórico).
--   name           nombre que venía en un fichero histórico (opcional).
--   import_id      lote de importación (newsletter_imports.id) que creó la fila, e imported_at su fecha.
--   status         admite 'imported': contacto histórico SIN consentimiento comercial acreditado. Nunca recibe correos:
--                  solo pasa a 'pending' si la propia persona se inscribe desde la web (y a 'active' al confirmar).
-- newsletter_imports: cada lote (etiqueta, fichero y su huella SHA-256, formato, idioma por defecto, recuentos, informe,
--                  quién y cuándo). Nunca se guarda el fichero.
-- campaign_campaigns.audience_kind / newsletter_locale: audiencia por etiquetas del CRM ('tags', como hasta ahora) o por
--                  lista de la newsletter ('newsletter': suscriptores confirmados, opcionalmente de un idioma).
ALTER TABLE newsletter_subscribers ADD COLUMN signup_locale VARCHAR(8) NULL;
ALTER TABLE newsletter_subscribers ADD COLUMN locale_source VARCHAR(16) NOT NULL DEFAULT 'web';
ALTER TABLE newsletter_subscribers ADD COLUMN name VARCHAR(200) NULL;
ALTER TABLE newsletter_subscribers ADD COLUMN import_id INT UNSIGNED NULL;
ALTER TABLE newsletter_subscribers ADD COLUMN imported_at BIGINT NULL;
UPDATE newsletter_subscribers SET signup_locale = locale WHERE signup_locale IS NULL;
ALTER TABLE newsletter_subscribers DROP CHECK chk_newsletter_subscribers_status;
ALTER TABLE newsletter_subscribers ADD CONSTRAINT chk_newsletter_subscribers_status_v2 CHECK (status IN ('pending', 'active', 'unsubscribed', 'imported'));
ALTER TABLE newsletter_subscribers ADD INDEX idx_newsletter_subscribers_locale (locale, status);

CREATE TABLE newsletter_imports (
  id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  label          VARCHAR(120) NOT NULL,
  file_name      VARCHAR(200) NOT NULL,
  file_sha256    CHAR(64)     NOT NULL,
  format         VARCHAR(8)   NOT NULL,
  default_locale VARCHAR(8)   NOT NULL,
  row_count      INT UNSIGNED NOT NULL DEFAULT 0,
  created_count  INT UNSIGNED NOT NULL DEFAULT 0,
  matched_count  INT UNSIGNED NOT NULL DEFAULT 0,
  rejected_count INT UNSIGNED NOT NULL DEFAULT 0,
  send_mails     TINYINT(1)   NOT NULL DEFAULT 0,
  report_json    MEDIUMTEXT   NULL,
  actor          VARCHAR(100) NOT NULL,
  created_at     BIGINT       NOT NULL,
  PRIMARY KEY (id),
  KEY idx_newsletter_imports_created (created_at),
  KEY idx_newsletter_imports_sha (file_sha256)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

ALTER TABLE campaign_campaigns ADD COLUMN newsletter_locale VARCHAR(8) NULL DEFAULT NULL;
ALTER TABLE campaign_campaigns ADD COLUMN audience_kind VARCHAR(16) NOT NULL DEFAULT 'tags';
