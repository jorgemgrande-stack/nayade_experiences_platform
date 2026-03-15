import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";

// Public pages
import Home from "./pages/Home";
import Experiences from "./pages/Experiences";
import ExperienceDetail from "./pages/ExperienceDetail";
import Gallery from "./pages/Gallery";
import BudgetRequest from "./pages/BudgetRequest";
import Contact from "./pages/Contact";
import Locations from "./pages/Locations";

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";
import SlideshowManager from "./pages/admin/cms/SlideshowManager";
import ExperiencesManager from "./pages/admin/products/ExperiencesManager";
import LeadsManager from "./pages/admin/quotes/LeadsManager";
import QuoteBuilder from "./pages/admin/quotes/QuoteBuilder";
import CalendarView from "./pages/admin/operations/CalendarView";
import AccountingDashboard from "./pages/admin/accounting/AccountingDashboard";

function Router() {
  return (
    <Switch>
      {/* ── PUBLIC ROUTES ── */}
      <Route path="/" component={Home} />
      <Route path="/experiencias" component={Experiences} />
      <Route path="/experiencias/:slug" component={ExperienceDetail} />
      <Route path="/galeria" component={Gallery} />
      <Route path="/presupuesto" component={BudgetRequest} />
      <Route path="/contacto" component={Contact} />
      <Route path="/ubicaciones" component={Locations} />
      <Route path="/ubicaciones/:slug" component={Locations} />

      {/* ── ADMIN ROUTES ── */}
      <Route path="/admin" component={AdminDashboard} />

      {/* CMS */}
      <Route path="/admin/cms" component={SlideshowManager} />
      <Route path="/admin/cms/slideshow" component={SlideshowManager} />

      {/* Products */}
      <Route path="/admin/productos" component={ExperiencesManager} />
      <Route path="/admin/productos/experiencias" component={ExperiencesManager} />

      {/* Quotes & Leads */}
      <Route path="/admin/presupuestos" component={LeadsManager} />
      <Route path="/admin/presupuestos/leads" component={LeadsManager} />
      <Route path="/admin/presupuestos/nuevo" component={QuoteBuilder} />

      {/* Operations */}
      <Route path="/admin/operaciones" component={CalendarView} />
      <Route path="/admin/operaciones/calendario" component={CalendarView} />

      {/* Accounting */}
      <Route path="/admin/contabilidad" component={AccountingDashboard} />
      <Route path="/admin/contabilidad/dashboard" component={AccountingDashboard} />

      {/* 404 */}
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
