-- Reversión de 0023_trial_open_mailbox: quita la columna generada y su índice. No toca ninguna prueba.
ALTER TABLE trial_requests DROP INDEX uq_trial_open_mailbox, DROP COLUMN open_mailbox;
