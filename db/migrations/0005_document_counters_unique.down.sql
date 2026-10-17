-- Reversión de 0005_document_counters_unique: retira el índice único (no toca datos). La numeración sigue
-- siendo atómica (server/documentNumbers.ts), pero la creación de series vuelve a depender solo de GET_LOCK.
DROP INDEX uq_document_counters_type_year ON document_counters;
