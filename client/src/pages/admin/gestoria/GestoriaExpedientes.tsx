/**
 * Expedientes para Gestoría — Gestoría e Impuestos (Fase 5).
 *
 * Genera expedientes ZIP del ejercicio (resúmenes IVA, laboral, sociedades y
 * calendario en CSV) y gestiona los accesos al Portal de Gestoría.
 */
import { useState } from "react";
import AdminLayout from "@/components/AdminLayout";
import { PanelEmpty, PanelError, PanelLoading, toastError } from "@/components/admin/PanelStates";
import { PanelDataList, PanelPageHeader, StatusBadge, type PanelColumn } from "@/components/admin/PanelUi";
import { trpc } from "@/lib/trpc";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { FolderArchive, RefreshCw, Download, UserPlus, FileArchive, Users } from "lucide-react";
import { FormField } from "../accounting/shared/EconomyUi";
import { useGestoriaLabels } from "./gestoriaLabels";
import { SectionCard, YearSelect } from "./GestoriaParts";

export default function GestoriaExpedientes() {
  const { t, f } = useGestoriaLabels();
  const currentYear = new Date().getFullYear();
  const [year, setYear] = useState(currentYear);
  const [gName, setGName] = useState("");
  const [gEmail, setGEmail] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const utils = trpc.useUtils();

  const dossiersQ = trpc.gestoria.dossiers.list.useQuery(undefined);
  const accessQ = trpc.gestoria.access.list.useQuery();

  const generateMut = trpc.gestoria.dossiers.generate.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.dossiers.generated"));
      utils.gestoria.dossiers.list.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const accessMut = trpc.gestoria.access.createPortalAccess.useMutation({
    onSuccess: () => {
      toast.success(t("gestoria.dossiers.accessCreated"));
      setGName(""); setGEmail(""); setShowErrors(false);
      utils.gestoria.access.list.invalidate();
    },
    onError: (e) => toastError(e),
  });

  const dossiers = dossiersQ.data ?? [];
  const accesses = accessQ.data ?? [];

  const dossierColumns: PanelColumn<(typeof dossiers)[number]>[] = [
    { key: "title", header: t("gestoria.dossiers.colTitle"), cell: (d) => d.title },
    { key: "created", header: t("gestoria.dossiers.colCreated"), cell: (d) => f.dateTime(new Date(d.createdAt)) },
    {
      key: "files",
      header: t("gestoria.dossiers.colFiles"),
      cell: (d) => (
        <span className="tabular-nums">
          {t("gestoria.dossiers.fileCount", { count: d.fileCount ?? 0 })}
          {d.fileSize ? ` · ${f.number(Math.round(d.fileSize / 1024))} KB` : ""}
        </span>
      ),
    },
    {
      key: "download",
      header: "",
      align: "right",
      hideOnMobile: false,
      cell: (d) =>
        d.fileUrl ? (
          <a href={d.fileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline">
            <Download className="h-4 w-4" aria-hidden="true" /> {t("gestoria.dossiers.download")}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground">{t("gestoria.dossiers.noFile")}</span>
        ),
    },
  ];

  const accessColumns: PanelColumn<(typeof accesses)[number]>[] = [
    { key: "name", header: t("gestoria.dossiers.colName"), cell: (a) => a.name },
    { key: "email", header: t("gestoria.dossiers.colEmail"), cell: (a) => <span className="break-all">{a.email}</span> },
    {
      key: "status",
      header: t("gestoria.dossiers.colState"),
      cell: (a) => <StatusBadge tone={a.inviteAccepted ? "success" : "warning"}>{a.inviteAccepted ? t("gestoria.dossiers.active") : t("gestoria.dossiers.pendingActivation")}</StatusBadge>,
    },
  ];

  return (
    <AdminLayout>
      <div className="mx-auto max-w-6xl space-y-6 p-6">
        <PanelPageHeader icon={<FolderArchive />} title={t("gestoria.dossiers.title")} description={t("gestoria.dossiers.description")} />

        <div className="grid items-start gap-4 lg:grid-cols-2">
          {/* Generar expediente */}
          <SectionCard icon={<FileArchive />} title={t("gestoria.dossiers.generateTitle")} description={t("gestoria.dossiers.generateHelp")}>
            <div className="flex flex-wrap items-end gap-3">
              <FormField label={t("gestoria.dossiers.year")}>
                <YearSelect year={year} onChange={setYear} className="w-44" />
              </FormField>
              <Button onClick={() => generateMut.mutate({ year })} disabled={generateMut.isPending} className="gap-2">
                {generateMut.isPending ? <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> : <FileArchive className="h-4 w-4" aria-hidden="true" />}
                {generateMut.isPending ? t("gestoria.dossiers.generating") : t("gestoria.dossiers.generate")}
              </Button>
            </div>
          </SectionCard>

          {/* Accesos de gestoría */}
          <SectionCard icon={<Users />} title={t("gestoria.dossiers.accessTitle")} description={t("gestoria.dossiers.accessHelp")}>
            <div className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <FormField label={t("gestoria.dossiers.gestoriaName")} required error={showErrors && !gName.trim() ? t("gestoria.dossiers.errName") : null}>
                  <Input value={gName} onChange={(e) => setGName(e.target.value)} placeholder="Gestoría Ejemplo S.L." autoComplete="off" />
                </FormField>
                <FormField label={t("gestoria.dossiers.gestoriaEmail")} required error={showErrors && !gEmail.trim() ? t("gestoria.dossiers.errEmail") : null}>
                  <Input type="email" value={gEmail} onChange={(e) => setGEmail(e.target.value)} placeholder="contacto@gestoria.com" autoComplete="off" />
                </FormField>
              </div>
              <Button
                onClick={() => {
                  if (!gName.trim() || !gEmail.trim()) { setShowErrors(true); toast.error(t("gestoria.dossiers.fillNameEmail")); return; }
                  accessMut.mutate({ name: gName.trim(), email: gEmail.trim() });
                }}
                disabled={accessMut.isPending}
                variant="outline"
                className="gap-2"
              >
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                {accessMut.isPending ? t("gestoria.dossiers.creating") : t("gestoria.dossiers.createAccess")}
              </Button>
            </div>
          </SectionCard>
        </div>

        {/* Lista de expedientes */}
        <section aria-labelledby="gestoria-expedientes-lista" className="space-y-2">
          <h2 id="gestoria-expedientes-lista" className="text-base font-semibold text-foreground">{t("gestoria.dossiers.listTitle")}</h2>
          {dossiersQ.isLoading ? (
            <PanelLoading />
          ) : dossiersQ.isError ? (
            <PanelError error={dossiersQ.error} onRetry={() => void dossiersQ.refetch()} />
          ) : dossiers.length === 0 ? (
            <PanelEmpty icon={<FolderArchive className="h-5 w-5" />} title={t("gestoria.dossiers.emptyTitle")} description={t("gestoria.dossiers.emptyHelp")} />
          ) : (
            <PanelDataList rows={dossiers} columns={dossierColumns} rowKey={(d) => d.id} caption={t("gestoria.dossiers.listTitle")} />
          )}
        </section>

        {/* Accesos existentes */}
        {accessQ.isError ? (
          <PanelError error={accessQ.error} onRetry={() => void accessQ.refetch()} />
        ) : accesses.length > 0 ? (
          <section aria-labelledby="gestoria-accesos-lista" className="space-y-2">
            <h2 id="gestoria-accesos-lista" className="text-base font-semibold text-foreground">{t("gestoria.dossiers.accessListTitle")}</h2>
            <PanelDataList rows={accesses} columns={accessColumns} rowKey={(a) => a.id} caption={t("gestoria.dossiers.accessListTitle")} />
          </section>
        ) : null}
      </div>
    </AdminLayout>
  );
}
