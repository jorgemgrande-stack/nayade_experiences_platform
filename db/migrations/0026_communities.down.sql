-- Reversión de 0026_communities: se pierden las comunidades, sus miembros, publicaciones, comentarios, reacciones,
-- guardados y actividad. Antes, desplegar el código anterior a este cambio.
DROP TABLE IF EXISTS community_activity;
DROP TABLE IF EXISTS community_saves;
DROP TABLE IF EXISTS community_reactions;
DROP TABLE IF EXISTS community_comments;
DROP TABLE IF EXISTS community_posts;
DROP TABLE IF EXISTS community_members;
DROP TABLE IF EXISTS communities;
