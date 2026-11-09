/**
 * TPV Advanced (Elephant Connect, capacidad pos-advanced): arqueos y conciliaciones, turnos, entrega y recepción de
 * caja, autorizaciones especiales, auditoría e informes. Sin licencia, una sola explicación con la vía de ampliación;
 * en solo lectura, el histórico se consulta y los formularios no se ofrecen. Quien decide es el servidor (tpvAdvanced.*).
 */
import { Link } from "wouter";
import AdminLayout from "@/components/AdminLayout";
import { trpc } from "@/lib/trpc";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { PanelEmpty, PanelError, PanelLoading } from "@/components/admin/PanelStates";
import { TONE_SURFACE } from "@/lib/panelTones";
import { Info, ShieldCheck, Sparkles } from "lucide-react";
import { TPV_ADVANCED_LABELS } from "@shared/tpvPlan";
import AdvSessionPanel from "./AdvSessionPanel";
import AdvAuthorizations from "./AdvAuthorizations";
import AdvAudit from "./AdvAudit";
import AdvReports from "./AdvReports";

function NotContracted() {
  return (
    <PanelEmpty
      icon={<Sparkles className="w-5 h-5" />}
      title="TPV Advanced no está contratado"
      description={
        <>
          Añade a tu caja: {TPV_ADVANCED_LABELS.join(", ").toLowerCase()}. Se contrata sobre la caja de tu plan por 19 €/mes + IVA, bajo solicitud.
        </>
      }
    >
      <Button asChild>
        <Link href="/admin/suscripcion">Solicitar TPV Advanced</Link>
      </Button>
      <Button asChild variant="outline">
        <Link href="/admin/tpv">Volver a la caja</Link>
      </Button>
    </PanelEmpty>
  );
}

export default function TpvAdvancedPage() {
  const plan = trpc.tpv.planInfo.useQuery();
  const advanced = plan.data?.advanced === true;
  const status = trpc.tpvAdvanced.status.useQuery(undefined, { enabled: advanced });

  let body;
  if (plan.isLoading || (advanced && status.isLoading)) body = <PanelLoading />;
  else if (plan.error) body = <PanelError error={plan.error} onRetry={() => plan.refetch()} />;
  else if (!advanced) body = <NotContracted />;
  else if (status.error || !status.data) body = <PanelError error={status.error} onRetry={() => status.refetch()} />;
  else {
    const s = status.data;
    body = (
      <>
        {!s.canWrite && (
          <div role="status" className={`mb-4 flex items-start gap-2 rounded-lg border p-3 text-sm text-foreground ${TONE_SURFACE.info}`}>
            <Info className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
            <p>
              Tu licencia de TPV Advanced está en solo lectura: puedes consultar arqueos, turnos, entregas, autorizaciones e informes, pero no registrar nada nuevo.{" "}
              <Link href="/admin/suscripcion" className="underline font-medium">Renovar desde Suscripción</Link>.
            </p>
          </div>
        )}
        <Tabs defaultValue="caja">
          <TabsList className="mb-4 flex flex-wrap h-auto">
            <TabsTrigger value="caja">Caja, turnos y arqueos</TabsTrigger>
            <TabsTrigger value="autorizaciones">Autorizaciones</TabsTrigger>
            {s.isManager && <TabsTrigger value="auditoria">Auditoría</TabsTrigger>}
            {s.isManager && <TabsTrigger value="informes">Informes</TabsTrigger>}
          </TabsList>
          <TabsContent value="caja"><AdvSessionPanel canWrite={s.canWrite} isManager={s.isManager} userId={s.userId} /></TabsContent>
          <TabsContent value="autorizaciones"><AdvAuthorizations canWrite={s.canWrite} isManager={s.isManager} isSupervisor={s.isSupervisor} userId={s.userId} /></TabsContent>
          {s.isManager && <TabsContent value="auditoria"><AdvAudit /></TabsContent>}
          {s.isManager && <TabsContent value="informes"><AdvReports /></TabsContent>}
        </Tabs>
      </>
    );
  }

  return (
    <AdminLayout>
      <div className="p-4 md:p-6 max-w-6xl mx-auto">
        <PanelPageHeader
          icon={<ShieldCheck />}
          title="TPV Advanced"
          description="Control de la caja por turnos: arqueos por billetes y monedas, entregas entre operadores, autorizaciones y auditoría."
          actions={<Button asChild variant="outline" size="sm"><Link href="/admin/tpv/cajas">Historial de cajas</Link></Button>}
        />
        {body}
      </div>
    </AdminLayout>
  );
}
