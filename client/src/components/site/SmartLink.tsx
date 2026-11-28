/**
 * Enlace de la web pública que sabe dónde está: en la vista previa del panel no navega; los externos abren pestaña
 * nueva; las anclas de la misma página desplazan hasta la sección (y rellenan los formularios con «#id?clave=valor»);
 * el resto va por el enrutador. Lo usan los bloques de Elephant Studio y las tarjetas de la agenda.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { scrollToHash } from "@/lib/scrollToHash";
import { hashQuery } from "@shared/studio/formPrefill";

const isExternal = (u: string) => /^(https?:|mailto:|tel:)/i.test(u);

export function SmartLink({ href, preview, className, children }: { href: string; preview?: boolean; className?: string; children: ReactNode }) {
  if (preview) {
    return (
      <a href={href} className={className} onClick={(e) => e.preventDefault()}>
        {children}
      </a>
    );
  }
  if (isExternal(href)) {
    const web = /^https?:/i.test(href);
    return (
      <a href={href} className={className} target={web ? "_blank" : undefined} rel={web ? "noopener noreferrer" : undefined}>
        {children}
      </a>
    );
  }
  // Ancla de la misma página (#contacto): enlace normal que desplaza hasta la sección (el enrutador no lo haría)
  if (href.startsWith("#")) {
    return (
      <a
        href={href}
        className={className}
        onClick={(e) => {
          e.preventDefault();
          if (window.location.hash !== href) history.pushState(null, "", href);
          // «#solicitud?experiencia=X»: los formularios de la página reciben la elección antes de llegar a ellos
          const q = hashQuery(href);
          if (q) window.dispatchEvent(new CustomEvent("studio:prefill", { detail: q }));
          scrollToHash(href);
        }}
      >
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}
