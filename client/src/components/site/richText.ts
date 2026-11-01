/**
 * Estilo de lectura de las páginas de la empresa: texto con el color de texto del tema sobre su fondo (contraste AA
 * en claro y en oscuro), títulos principales con su color de marca (texto grande) y enlaces subrayados con ese color.
 */
export const RICH_TEXT_CLASS =
  "break-words text-base leading-relaxed text-foreground " +
  "[&_h1]:font-heading [&_h1]:text-3xl md:[&_h1]:text-4xl [&_h1]:font-bold [&_h1]:leading-tight [&_h1]:text-primary [&_h1]:mb-6 " +
  "[&_h2]:font-heading [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-10 [&_h2]:mb-3 " +
  "[&_h3]:text-xl [&_h3]:font-semibold [&_h3]:text-foreground [&_h3]:mt-8 [&_h3]:mb-2 " +
  "[&_p]:my-4 [&_ul]:my-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-1.5 " +
  "[&_a]:text-foreground [&_a]:underline [&_a]:decoration-primary [&_a]:decoration-2 [&_a]:underline-offset-4 " +
  "[&_strong]:font-semibold [&_b]:font-semibold [&_img]:my-6 [&_img]:h-auto [&_img]:max-w-full [&_img]:rounded-xl " +
  "[&_blockquote]:my-6 [&_blockquote]:border-l-4 [&_blockquote]:border-primary [&_blockquote]:pl-4 [&_blockquote]:italic " +
  "[&_table]:my-6 [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left";
