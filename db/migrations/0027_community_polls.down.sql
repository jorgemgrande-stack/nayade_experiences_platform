-- Reversión de 0027_community_polls: se pierden las encuestas y sus respuestas, las propuestas de los miembros y sus
-- apoyos, y los reportes de contenido. Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS community_reports;
DROP TABLE IF EXISTS community_proposal_supports;
DROP TABLE IF EXISTS community_proposals;
DROP TABLE IF EXISTS community_poll_values;
DROP TABLE IF EXISTS community_poll_responses;
DROP TABLE IF EXISTS community_poll_options;
DROP TABLE IF EXISTS community_polls;
