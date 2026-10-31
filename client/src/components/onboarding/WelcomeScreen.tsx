/**
 * Bienvenida a Elephant Core: lo primero que ve el administrador de una empresa nueva, sin el panel lleno de
 * opciones. Lleva al asistente o deja «explorar primero»; la elección se guarda en el servidor (por empresa), así
 * que no vuelve a aparecer en otra sesión ni en otro navegador.
 */
import { useLocation } from "wouter";
import { toast } from "sonner";
import { ArrowRight, Building2, Compass, Loader2, Rocket, ShieldCheck } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { SETUP_WIZARD_PATH } from "@/components/SetupWizardLink";

export function WelcomeScreen({ firstName, tradeName, steps }: { firstName: string; tradeName: string; steps: number }) {
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const setStep = trpc.setupWizard.setStep.useMutation({
    onError: (e) => toast.error(e.message || "No se pudo guardar"),
  });
  const choose = async (status: "done" | "skipped") => {
    await setStep.mutateAsync({ step: "welcome", status });
    await utils.setupWizard.status.invalidate();
    if (status === "done") navigate(SETUP_WIZARD_PATH);
  };
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-3 text-center">
          <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary" aria-hidden="true">
            <Rocket className="h-7 w-7" />
          </span>
          <h1 className="text-2xl font-bold text-foreground sm:text-3xl">
            {firstName ? `Hola, ${firstName}. ` : ""}Te damos la bienvenida a Elephant Core
          </h1>
          <p className="text-muted-foreground">
            {tradeName ? <>Tu espacio para gestionar <strong className="text-foreground">{tradeName}</strong> ya está listo.</> : <>Tu espacio de gestión ya está listo.</>}{" "}
            Te proponemos dejarlo configurado en unos minutos.
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Building2, title: "Solo lo necesario", text: `${steps} pasos cortos adaptados a tu negocio y a lo que tienes contratado.` },
            { icon: ShieldCheck, title: "Sin perder nada", text: "El progreso se guarda solo: puedes dejarlo y continuar cuando quieras." },
            { icon: Compass, title: "Sin bloqueos", text: "Ningún paso es obligatorio para empezar a usar el sistema." },
          ].map((x) => (
            <li key={x.title} className="rounded-2xl border border-border bg-card p-4">
              <x.icon className="h-5 w-5 text-primary" aria-hidden="true" />
              <p className="mt-2 text-sm font-medium text-foreground">{x.title}</p>
              <p className="mt-1 text-xs text-muted-foreground">{x.text}</p>
            </li>
          ))}
        </ul>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:justify-center">
          <Button type="button" size="lg" disabled={setStep.isPending} onClick={() => void choose("done")}>
            {setStep.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Configurar mi empresa <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="lg" variant="outline" disabled={setStep.isPending} onClick={() => void choose("skipped")}>
            Explorar primero
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">Podrás abrir el asistente en cualquier momento desde el Inicio.</p>
      </div>
    </main>
  );
}

export default WelcomeScreen;
