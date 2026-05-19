/**
 * MyDocuments — Lista de documentos propios del empleado (Fase 3 RRHH).
 *
 * Solo lectura. Los documentos los sube el admin desde la ficha del empleado
 * en /admin/personal/empleados/:id (versión clásica).
 */
import { FileText, ExternalLink, Loader2, Calendar } from "lucide-react";
import EmployeeLayout from "./EmployeeLayout";
import { trpc } from "@/lib/trpc";

const DOC_TYPE_LABELS: Record<string, string> = {
  dni: "DNI / NIE",
  contrato: "Contrato",
  certificado: "Certificado",
  prl: "Prevención de Riesgos",
  formacion: "Formación",
  nomina_pdf: "Nómina (PDF)",
  baja_medica: "Baja médica",
  finiquito: "Finiquito",
  otro: "Otro",
};

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return null;
  return new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

export default function MyDocuments() {
  const { data: docs, isLoading } = trpc.hr.portal.myDocuments.useQuery();

  return (
    <EmployeeLayout>
      <div className="space-y-5">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-orange-400" />
            Mis documentos
          </h1>
          <p className="text-sm text-white/50 mt-1">
            Documentos asociados a tu expediente. Solo lectura — para subir nuevos contacta con RR.HH.
          </p>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-orange-500 animate-spin" />
          </div>
        )}

        {!isLoading && (!docs || docs.length === 0) && (
          <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-10 text-center">
            <FileText className="w-10 h-10 mx-auto mb-3 text-white/20" />
            <p className="text-sm text-white/50">No tienes documentos disponibles todavía.</p>
          </div>
        )}

        {!isLoading && docs && docs.length > 0 && (
          <div className="rounded-xl border border-white/[0.08] overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-white/[0.04] border-b border-white/[0.08]">
                <tr className="text-left text-[10px] uppercase tracking-widest text-white/50">
                  <th className="px-4 py-3">Tipo</th>
                  <th className="px-4 py-3">Nombre</th>
                  <th className="px-4 py-3 hidden md:table-cell">Vencimiento</th>
                  <th className="px-4 py-3 hidden md:table-cell">Subido</th>
                  <th className="px-4 py-3 text-right">Archivo</th>
                </tr>
              </thead>
              <tbody>
                {docs.map(d => {
                  const isExpiringSoon = d.expiresAt &&
                    new Date(d.expiresAt).getTime() - Date.now() < 30 * 24 * 60 * 60 * 1000 &&
                    new Date(d.expiresAt).getTime() > Date.now();
                  const isExpired = d.expiresAt && new Date(d.expiresAt).getTime() < Date.now();
                  return (
                    <tr key={d.id} className="border-b border-white/[0.05] hover:bg-white/[0.03]">
                      <td className="px-4 py-3">
                        <span className="text-xs px-2 py-0.5 rounded-full bg-orange-500/15 text-orange-300 border border-orange-500/30">
                          {DOC_TYPE_LABELS[d.type] ?? d.type}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-white/90">{d.name}</td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {d.expiresAt ? (
                          <span className={`inline-flex items-center gap-1 text-xs ${
                            isExpired ? "text-rose-400" : isExpiringSoon ? "text-amber-400" : "text-white/70"
                          }`}>
                            <Calendar className="w-3 h-3" />
                            {fmtDate(d.expiresAt)}
                            {isExpired && <span className="text-[10px] uppercase ml-1">(vencido)</span>}
                            {!isExpired && isExpiringSoon && <span className="text-[10px] uppercase ml-1">(próximo)</span>}
                          </span>
                        ) : <span className="text-white/30">—</span>}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell text-white/70 text-xs">
                        {fmtDate(d.createdAt) ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <a
                          href={d.fileUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-orange-300 hover:text-orange-200 inline-flex items-center gap-1"
                        >
                          Abrir <ExternalLink className="w-3 h-3" />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </EmployeeLayout>
  );
}
