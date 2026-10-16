-- Reversión de 0007_blog_posts: elimina la tabla del blog y sus entradas. Retirar antes el código que
-- la usa y exportar las entradas si hay que conservarlas.
DROP TABLE IF EXISTS blog_posts;
