-- Reversión de 0085_user_ui_prefs.sql: elimina solo las preferencias de idioma (cada usuario vuelve al idioma principal).
DROP TABLE IF EXISTS user_ui_prefs;
