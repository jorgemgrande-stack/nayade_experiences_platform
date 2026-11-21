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
import { useI18n } from "@/i18n/I18nProvider";

export function WelcomeScreen({ firstName, tradeName, steps }: { firstName: string; tradeName: string; steps: number }) {
  const { t } = useI18n();
  const [, navigate] = useLocation();
  const utils = trpc.useUtils();
  const setStep = trpc.setupWizard.setStep.useMutation({
    onError: (e) => toast.error(e.message || t("onboardingShared.welcome.saveError")),
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
            {firstName ? t("onboardingShared.welcome.hello", { name: firstName }) : ""}{t("onboardingShared.welcome.title")}
          </h1>
          <p className="text-muted-foreground">
            {tradeName ? t("onboardingShared.welcome.readyNamed", { name: tradeName }) : t("onboardingShared.welcome.ready")}{" "}
            {t("onboardingShared.welcome.proposal")}
          </p>
        </div>

        <ul className="grid gap-3 sm:grid-cols-3">
          {[
            { icon: Building2, title: t("onboardingShared.welcome.onlyNeeded.title"), text: t("onboardingShared.welcome.onlyNeeded.text", { steps }) },
            { icon: ShieldCheck, title: t("onboardingShared.welcome.nothingLost.title"), text: t("onboardingShared.welcome.nothingLost.text") },
            { icon: Compass, title: t("onboardingShared.welcome.noBlocks.title"), text: t("onboardingShared.welcome.noBlocks.text") },
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
            {t("onboardingShared.welcome.configure")} <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
          </Button>
          <Button type="button" size="lg" variant="outline" disabled={setStep.isPending} onClick={() => void choose("skipped")}>
            {t("onboardingShared.welcome.explore")}
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">{t("onboardingShared.welcome.footer")}</p>
      </div>
    </main>
  );
}

export default WelcomeScreen;
