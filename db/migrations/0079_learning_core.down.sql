-- Reversión de 0079: borra el contenido, las matrículas, sus reglas y el progreso del LMS (los ficheros subidos no se tocan).
DROP TABLE IF EXISTS learning_progress;
DROP TABLE IF EXISTS learning_access_rule_modules;
DROP TABLE IF EXISTS learning_access_rules;
DROP TABLE IF EXISTS learning_access_events;
DROP TABLE IF EXISTS learning_enrollment_modules;
DROP TABLE IF EXISTS learning_enrollments;
DROP TABLE IF EXISTS learning_blocks;
DROP TABLE IF EXISTS learning_resources;
DROP TABLE IF EXISTS learning_lessons;
DROP TABLE IF EXISTS learning_modules;
DROP TABLE IF EXISTS learning_courses;
