/**
 * Web › Idiomas (E-1): idiomas de la web de la empresa y estado de la traducción de cada página.
 * Nada se traduce ni se publica solo: cada idioma y cada traducción los valida una persona.
 * Diseño: docs/architecture/studio-multidioma.md.
 */
import { useState } from "react";
import { Link } from "wouter";
import { toast } from "sonner";
import { Languages } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toastError } from "@/components/admin/PanelStates";
import { localeAutonym } from "@/hooks/useSiteLocale";
import { useStudioText } from "@/components/admin/studio/useStudioText";
import { PanelError } from "@/components/admin/PanelStates";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import CmsSectionNav from "./CmsSectionNav";

export default function Idiomas() {
  const tx = useStudioText();
  const utils = trpc.useUtils();
  const cfg = trpc.cms.i18nConfig.useQuery();
  const pages = trpc.cms.sitePages.useQuery();
  const [code, setCode] = useState("");
  const refresh = () => {
    void utils.cms.i18nConfig.invalidate();
    void utils.cms.pageTranslations.invalidate();
  };
  const opts = { onSuccess: refresh, onError: (e: unknown) => toastError(e) };
  const add = trpc.cms.i18nAddLocale.useMutation({ ...opts, onSuccess: () => { setCode(""); refresh(); toast.success(tx("Idioma añadido en borrador. No es público hasta que lo valides.")); } });
  const setValidated = trpc.cms.i18nSetLocaleValidated.useMutation(opts);
  const remove = trpc.cms.i18nRemoveLocale.useMutation(opts);
  const settings = trpc.cms.i18nSettings.useMutation(opts);
  const extra = (cfg.data?.locales ?? []).filter((l) => !l.isDefault);

  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-8 p-4 md:p-6">
        <CmsSectionNav />
        <PanelPageHeader
          className="mb-0"
          icon={<Languages />}
          title={tx("Idiomas de tu web")}
          description={tx("El idioma principal es «{v}». Añade otros y traduce tus páginas a mano: no se traduce nada automáticamente y un idioma solo se ve en tu web cuando lo validas, página a página.", { v: localeAutonym(cfg.data?.defaultLocale ?? "es") })}
        />
        {cfg.isError && <PanelError error={cfg.error} onRetry={() => void cfg.refetch()} />}

        <section aria-labelledby="idiomas-h" className="space-y-3">
          <h2 id="idiomas-h" className="text-lg font-semibold">{tx("Idiomas")}</h2>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => { e.preventDefault(); if (code.trim()) add.mutate({ locale: code }); }}
          >
            <div>
              <Label htmlFor="nuevo-idioma">{tx("Código del idioma (de, en, fr, pt-br…)")}</Label>
              <Input id="nuevo-idioma" value={code} onChange={(e) => setCode(e.target.value)} maxLength={35} className="w-48" />
            </div>
            <Button type="submit" disabled={add.isPending || !code.trim()}>{tx("Añadir idioma")}</Button>
          </form>
          {extra.length === 0 ? (
            <p className="text-sm text-muted-foreground">{tx("Tu web está solo en el idioma principal.")}</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {extra.map((l) => (
                <li key={l.locale} className="flex flex-wrap items-center justify-between gap-2 p-3">
                  <span className="font-medium">{localeAutonym(l.locale)} <span className="text-muted-foreground">({l.locale})</span></span>
                  <span className="flex items-center gap-2">
                    <Badge variant={l.status === "validated" ? "default" : "secondary"}>{l.status === "validated" ? tx("Validado: visible") : tx("Borrador: no visible")}</Badge>
                    <Button size="sm" variant="outline" onClick={() => setValidated.mutate({ locale: l.locale, validated: l.status !== "validated" })}>
                      {l.status === "validated" ? tx("Retirar de la web") : tx("Validar idioma")}
                    </Button>
                    {l.status !== "validated" && (
                      <Button size="sm" variant="ghost" onClick={() => remove.mutate({ locale: l.locale })}>{tx("Quitar")}</Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {extra.length > 0 && (
            <div className="space-y-2 rounded-md border p-3 text-sm">
              <p className="font-medium">{tx("Si una página no está traducida")}</p>
              <label className="flex items-center gap-2">
                <input type="radio" name="fallback" checked={cfg.data?.fallback !== "default"} onChange={() => settings.mutate({ fallback: "hide" })} />{tx("No mostrarla en ese idioma (recomendado)")}</label>
              <label className="flex items-center gap-2">
                <input type="radio" name="fallback" checked={cfg.data?.fallback === "default"} onChange={() => settings.mutate({ fallback: "default" })} />{tx("Mostrar la del idioma principal, indicándolo (sin indexar)")}</label>
            </div>
          )}
        </section>

        {extra.length > 0 && (
          <section aria-labelledby="paginas-h" className="space-y-3">
            <h2 id="paginas-h" className="text-lg font-semibold">{tx("Traducción de páginas")}</h2>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left"><tr><th className="p-2">{tx("Página")}</th>{extra.map((l) => <th key={l.locale} className="p-2">{localeAutonym(l.locale)}</th>)}</tr></thead>
                <tbody>
                  {(pages.data ?? []).map((p) => (
                    <PageRow key={p.slug} slug={p.slug} title={p.title} locales={extra.map((l) => l.locale)} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </AdminLayout>
  );
}

function PageRow({ slug, title, locales }: { slug: string; title: string; locales: string[] }) {
  const tx = useStudioText();
  const q = trpc.cms.pageTranslations.useQuery({ slug });
  return (
    <tr className="border-t">
      <td className="p-2 font-medium">{title}</td>
      {locales.map((loc) => {
        const s = q.data?.find((x) => x.locale === loc);
        const label = !s || !s.exists ? tx("Sin traducir") : s.status === "validated" ? (s.hasPendingChanges ? tx("Validada, con cambios") : tx("Validada")) : tx("Borrador");
        return (
          <td key={loc} className="p-2">
            <Link href={`/admin/cms/idiomas/${slug}/${loc}`} className="underline-offset-2 hover:underline">{label}</Link>
            {s?.principalChanged && <span className="ml-2 text-xs text-warning">{tx("el original ha cambiado")}</span>}
          </td>
        );
      })}
    </tr>
  );
}
