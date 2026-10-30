-- Vuelta atrás de 0001_windows.sql: los contadores por ventana se pierden (el histórico sigue en usage_hourly)
-- y el Core degrada al limitador local con aviso mientras la tabla no exista.

DROP TABLE IF EXISTS usage_windows;
