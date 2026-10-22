import { Wrench } from "lucide-react";
import { trpc } from "@/lib/trpc";

const DEFAULT_MESSAGE =
  "Aviso importante\n\n" +
  "Reservas online temporalmente no disponibles\n\n" +
  "En estos momentos, el servicio de reservas online se encuentra temporalmente desactivado.\n\n" +
  "Para información o nuevas reservas, contacta directamente con nosotros.\n\n" +
  "Gracias por vuestra comprensión";

function splitMessage(message: string) {
  const blocks = message.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);
  if (blocks.length >= 3) {
    const [eyebrow, headline, ...body] = blocks;
    return { eyebrow, headline, body };
  }
  if (blocks.length === 2) {
    const [headline, ...body] = blocks;
    return { eyebrow: null, headline, body };
  }
  return { eyebrow: null, headline: blocks[0] ?? DEFAULT_MESSAGE, body: [] as string[] };
}

export default function MaintenanceNotice({ message }: { message?: string | null }) {
  const { data: publicSettings } = trpc.config.getPublicSettings.useQuery();
  // Logo y nombre de la empresa; sin ellos, nada (nunca los de otra instalación)
  const brandLogo = publicSettings?.brand_logo_url || "";
  const brandName = publicSettings?.brand_name || "";
  const { eyebrow, headline, body } = splitMessage(message?.trim() || DEFAULT_MESSAGE);

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background px-4 py-16">
      <div className="max-w-lg w-full text-center">
        {brandLogo && <img src={brandLogo} alt={brandName} className="h-16 w-16 object-contain rounded-full mx-auto mb-6" />}

        <div className="flex justify-center mb-4">
          <div className="p-3 rounded-full bg-amber-500/10">
            <Wrench className="h-7 w-7 text-amber-500" />
          </div>
        </div>

        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 dark:text-amber-400 mb-2">
            {eyebrow}
          </p>
        )}

        <h1 className="text-2xl font-bold text-foreground mb-4">{headline}</h1>

        <div className="space-y-3">
          {body.map((paragraph, i) => (
            <p key={i} className="text-muted-foreground whitespace-pre-line leading-relaxed">
              {paragraph}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
