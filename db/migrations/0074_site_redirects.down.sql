-- Reversión de 0074: se borran las reglas de redirección y su auditoría (la web vuelve a no redirigir nada).
DROP TABLE IF EXISTS site_redirect_log;
DROP TABLE IF EXISTS site_redirects;
