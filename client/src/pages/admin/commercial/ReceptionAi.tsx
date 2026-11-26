/**
 * Elephant Connect · Reception AI (/admin/atencion-comercial/recepcionista): recepcionista virtual con IA que atiende
 * llamadas (asistente de voz en la cuenta de Vapi de la empresa) y el chat de su web cuando el equipo no puede.
 * Registro de conversaciones con su resultado (ventas y administración); configuración, conocimiento, voz y chat
 * (administración). La autorización real (licencia `reception-ai` y rol) la aplica el servidor.
 * Las pestañas están en ReceptionAiParts.tsx.
 */
import { useState } from "react";
import { Bot } from "lucide-react";
import AdminLayout from "@/components/AdminLayout";
import { useAuth } from "@/_core/hooks/useAuth";
import { useI18n } from "@/i18n/I18nProvider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PanelPageHeader } from "@/components/admin/PanelUi";
import { ChatTab, KnowledgeTab, Registry, SettingsTab, VoiceTab } from "./ReceptionAiParts";

export default function ReceptionAi() {
  const { t } = useI18n();
  const { user } = useAuth();
  const isAdmin = (user as { role?: string } | null)?.role === "admin";
  const [tab, setTab] = useState("registro");
  return (
    <AdminLayout>
      <div className="mx-auto max-w-5xl space-y-6">
        <PanelPageHeader
          className="mb-0"
          icon={<Bot />}
          title={
            <>
              <span className="mb-0.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">{t("receptionAi.eyebrow")}</span>
              {t("receptionAi.title")}
            </>
          }
          description={<span className="block max-w-3xl">{t("receptionAi.description")}</span>}
        />
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="h-auto flex-wrap">
            <TabsTrigger value="registro">{t("receptionAi.tab.registry")}</TabsTrigger>
            {isAdmin && <TabsTrigger value="configuracion">{t("receptionAi.tab.settings")}</TabsTrigger>}
            {isAdmin && <TabsTrigger value="conocimiento">{t("receptionAi.tab.knowledge")}</TabsTrigger>}
            {isAdmin && <TabsTrigger value="voz">{t("receptionAi.tab.voice")}</TabsTrigger>}
            {isAdmin && <TabsTrigger value="chat">{t("receptionAi.tab.chat")}</TabsTrigger>}
          </TabsList>
          <TabsContent value="registro" className="pt-4"><Registry /></TabsContent>
          {isAdmin && <TabsContent value="configuracion" className="pt-4"><SettingsTab /></TabsContent>}
          {isAdmin && <TabsContent value="conocimiento" className="pt-4"><KnowledgeTab /></TabsContent>}
          {isAdmin && <TabsContent value="voz" className="pt-4"><VoiceTab /></TabsContent>}
          {isAdmin && <TabsContent value="chat" className="pt-4"><ChatTab /></TabsContent>}
        </Tabs>
      </div>
    </AdminLayout>
  );
}
