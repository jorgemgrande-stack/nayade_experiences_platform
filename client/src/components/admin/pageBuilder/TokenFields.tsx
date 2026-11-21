/**
 * Campos de una línea (y de varias, sin formato) del constructor que muestran debajo cómo se verán los datos de la
 * empresa: `{{nombre}}` aparece como el distintivo «Nombre de tu empresa». Lo que se guarda es el marcador.
 */
import type { ComponentProps } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { hasSiteTokens, splitTokens, TOKEN_BADGE_CLASS } from "@shared/siteTokenLabels";
import { useStudioText } from "@/components/admin/studio/useStudioText";

export function TokenPreview({ text }: { text: unknown }) {
  const tx = useStudioText();
  const value = typeof text === "string" ? text : "";
  if (!hasSiteTokens(value)) return null;
  return (
    <p className="text-xs text-muted-foreground" data-testid="token-preview">{tx("En tu web se verá:")}{" "}
      {splitTokens(value).map((p, i) =>
        "token" in p ? (
          <span key={i} className={TOKEN_BADGE_CLASS} title={tx("Se rellena con el dato de «Datos de la empresa» ({v})", { v: tx.lower(tx(p.label)) })}>
            {tx(p.label)}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </p>
  );
}

export function TokenInput(props: ComponentProps<typeof Input>) {
  return (
    <>
      <Input {...props} />
      <TokenPreview text={props.value} />
    </>
  );
}

export function TokenTextarea(props: ComponentProps<typeof Textarea>) {
  return (
    <>
      <Textarea {...props} />
      <TokenPreview text={props.value} />
    </>
  );
}
