-- Idioma de la interfaz del panel, por usuario (i18n del administrador). Aditiva: tabla nueva, no toca `users` ni ninguna otra.
-- El idioma es de la INTERFAZ de cada persona; nunca cambia datos de la empresa ni el idioma de otros usuarios.
CREATE TABLE IF NOT EXISTS user_ui_prefs (
  user_id    INT NOT NULL,
  ui_locale  VARCHAR(8) NOT NULL,
  updated_at BIGINT NOT NULL,
  PRIMARY KEY (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
