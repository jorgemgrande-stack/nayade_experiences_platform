import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, httpLink, splitLink, TRPCClientError } from "@trpc/client";
import { unbatchedTrpcPath } from "@shared/employeePortal";
import { isTenantSite } from "@/lib/tenantSite";
import { notifyIfReadOnlyBlocked } from "@/lib/readOnlyBlock";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { CartProvider } from "./contexts/CartContext";
import { getLoginUrl } from "./const";
import "./index.css";
import { installStaleBuildReload } from "@/lib/staleBuildReload";

// Pantalla abierta durante un despliegue: si falta una página de la versión anterior, recarga una vez
installStaleBuildReload(window);

const queryClient = new QueryClient();

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;

  if (!isUnauthorized) return;

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    // Crear, editar o guardar con el panel en consulta: un único aviso con la acción de reactivar
    notifyIfReadOnlyBlocked(error);
    console.error("[API Mutation Error]", error);
  }
});

const linkOptions = {
  url: "/api/trpc",
  transformer: superjson,
  fetch(input: RequestInfo | URL, init?: RequestInit) {
    return globalThis.fetch(input, {
      ...(init ?? {}),
      credentials: "include",
    });
  },
};

// Web de una empresa (multiempresa): consultas sueltas. Las licencias y los módulos se comprueban por petición HTTP, y
// en una petición agrupada bastaba una consulta no contratada para tumbar también las públicas (tema, menú, página)
const trpcClient = trpc.createClient({
  links: isTenantSite()
    ? [httpLink(linkOptions)]
    : [
        // Portal del empleado: también sueltas (sin Elephant People, «Mis clases» de Ski Net no cae con el 403 de Personal)
        splitLink({ condition: () => unbatchedTrpcPath(window.location.pathname), true: httpLink(linkOptions), false: httpBatchLink(linkOptions) }),
      ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <App />
      </CartProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
