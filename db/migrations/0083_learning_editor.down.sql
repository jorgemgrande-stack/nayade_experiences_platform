-- Reversión de 0083_learning_editor.sql: elimina los borradores y las versiones del editor. El contenido publicado, el progreso
-- y las matrículas NO se tocan.
DROP TABLE IF EXISTS learning_course_versions;
DROP TABLE IF EXISTS learning_course_drafts;
