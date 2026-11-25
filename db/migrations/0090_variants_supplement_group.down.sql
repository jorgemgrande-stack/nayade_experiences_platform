-- Reversión de 0090: las filas dejan de ser suplementos (se retira la columna; conviene borrar antes esas filas si no deben verse como opciones).
ALTER TABLE experience_variants DROP COLUMN supplementGroup;
