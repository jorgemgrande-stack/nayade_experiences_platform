import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import CookieBanner from "./components/CookieBanner";
import { ThemeProvider } from "./contexts/ThemeContext";

// ── PUBLIC PAGES (carga inmediata — visibles sin autenticación) ──────────────
import Home from "./pages/Home";
import Experiences from "./pages/Experiences";
import ExperienceDetail from "./pages/ExperienceDetail";
import Gallery from "./pages/Gallery";
import BudgetRequest from "./pages/BudgetRequest";
import CanjearCupon from "./pages/CanjearCupon";
import Contact from "./pages/Contact";
import Locations from "./pages/Locations";
import LegoPacksHome from "./pages/LegoPacksHome";
import LegoPacksList from "./pages/LegoPacksList";
import LegoPackDetail from "./pages/LegoPackDetail";
import Hotel from "./pages/Hotel";
import Spa from "./pages/Spa";
import Restaurantes from "./pages/Restaurantes";
import RestauranteDetail from "./pages/RestauranteDetail";
import RestauranteReservaOk from "./pages/RestauranteReservaOk";
import RestauranteReservaKo from "./pages/RestauranteReservaKo";
import ReservaOk from "./pages/ReservaOk";
import ReservaError from "./pages/ReservaError";
import SetPassword from "./pages/SetPassword";
import Login from "./pages/Login";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import DynamicPage from "./pages/DynamicPage";
import QuoteAcceptance from "./pages/QuoteAcceptance";
import HotelRoom from "./pages/HotelRoom";
import SpaDetail from "./pages/SpaDetail";
import RestaurantBooking from "./pages/RestaurantBooking";
import Checkout from "./pages/Checkout";
import PoliticaPrivacidad from "./pages/PoliticaPrivacidad";
import TerminosCondiciones from "./pages/TerminosCondiciones";
import PoliticaCookies from "./pages/PoliticaCookies";
import CondicionesCancelacion from "./pages/CondicionesCancelacion";

// ── ADMIN PAGES (lazy — solo se cargan cuando el usuario navega a /admin) ────
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));

// CMS
const SlideshowManager = lazy(() => import("./pages/admin/cms/SlideshowManager"));
const MenusManager = lazy(() => import("./pages/admin/cms/MenusManager"));
const PagesManager = lazy(() => import("./pages/admin/cms/PagesManager"));
const MultimediaManager = lazy(() => import("./pages/admin/cms/MultimediaManager"));
const HomeModulesManager = lazy(() => import("./pages/admin/cms/HomeModulesManager"));
const GalleryManager = lazy(() => import("./pages/admin/cms/GalleryManager"));

// Products
const ExperiencesManager = lazy(() => import("./pages/admin/products/ExperiencesManager"));
const CategoriesManager = lazy(() => import("./pages/admin/products/CategoriesManager"));
const LocationsManager = lazy(() => import("./pages/admin/products/LocationsManager"));
const VariantsManager = lazy(() => import("./pages/admin/products/VariantsManager"));
const LegoPacksManager = lazy(() => import("./pages/admin/products/LegoPacksManager"));

// Operations
const CalendarView = lazy(() => import("./pages/admin/operations/CalendarView"));
const BookingsList = lazy(() => import("./pages/admin/operations/BookingsList"));
const DailyOrders = lazy(() => import("./pages/admin/operations/DailyOrders"));

// Accounting
const AccountingDashboard = lazy(() => import("./pages/admin/accounting/AccountingDashboard"));
const TransactionsList = lazy(() => import("./pages/admin/accounting/TransactionsList"));
const AccountingReports = lazy(() => import("./pages/admin/accounting/AccountingReports"));
const ExpensesManager = lazy(() => import("./pages/admin/accounting/ExpensesManager"));
const ExpenseCategoriesManager = lazy(() => import("./pages/admin/accounting/ExpenseCategoriesManager"));
const ExpenseSuppliersManager = lazy(() => import("./pages/admin/accounting/ExpenseSuppliersManager"));
const RecurringExpensesManager = lazy(() => import("./pages/admin/accounting/RecurringExpensesManager"));
const ProfitLossReport = lazy(() => import("./pages/admin/accounting/ProfitLossReport"));

// Hotel & SPA
const HotelManager = lazy(() => import("./pages/admin/hotel/HotelManager"));
const SpaManager = lazy(() => import("./pages/admin/spa/SpaManager"));
const ReviewsManager = lazy(() => import("./pages/admin/ReviewsManager"));

// Restaurants Admin
const RestaurantsManager = lazy(() => import("./pages/admin/restaurants/RestaurantsManager"));
const GlobalCalendar = lazy(() => import("./pages/admin/restaurants/GlobalCalendar"));

// Users & Settings
const UsersManager = lazy(() => import("./pages/admin/users/UsersManager"));
const Settings = lazy(() => import("./pages/admin/settings/Settings"));

// CRM
const CRMDashboard = lazy(() => import("./pages/admin/crm/CRMDashboard"));
const ClientsManager = lazy(() => import("./pages/admin/crm/ClientsManager"));
const SolicitarAnulacion = lazy(() => import("./pages/SolicitarAnulacion"));

// Fiscal REAV
const ReavManager = lazy(() => import("./pages/admin/fiscal/ReavManager"));

// Suppliers & Settlements
const SuppliersManager = lazy(() => import("./pages/admin/suppliers/SuppliersManager"));
const SettlementsManager = lazy(() => import("./pages/admin/suppliers/SettlementsManager"));

// Marketing
const DiscountCodesManager = lazy(() => import("./pages/DiscountCodesManager"));
const CuponesManager = lazy(() => import("./pages/admin/marketing/CuponesManager"));
const PlatformsManager = lazy(() => import("./pages/admin/marketing/PlatformsManager"));

// TPV
const TpvScreen = lazy(() => import("./pages/admin/tpv/TpvScreen"));
const TpvBackoffice = lazy(() => import("./pages/admin/tpv/TpvBackoffice"));

// Plantillas Email
const EmailTemplatesManager = lazy(() => import("./pages/admin/EmailTemplatesManager"));
const PdfTemplatesManager = lazy(() => import("./pages/admin/PdfTemplatesManager"));

// Fallback de carga para páginas admin
function AdminLoadingFallback() {
  return (
    <div className="min-h-screen bg-[#080e1c] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      {/* ── PUBLIC ROUTES ── */}
      <Route path="/" component={Home} />
      <Route path="/experiencias" component={Experiences} />
      <Route path="/experiencias/:slug" component={ExperienceDetail} />
      <Route path="/galeria" component={Gallery} />
      <Route path="/presupuesto" component={BudgetRequest} />
      <Route path="/canjear-cupon" component={CanjearCupon} />
      <Route path="/solicitar-anulacion">{() => <Suspense fallback={<AdminLoadingFallback />}><SolicitarAnulacion /></Suspense>}</Route>
      <Route path="/presupuesto/:token" component={QuoteAcceptance} />
      <Route path="/contacto" component={Contact} />
      <Route path="/ubicaciones" component={Locations} />
      <Route path="/ubicaciones/:slug" component={Locations} />
      <Route path="/lego-packs" component={LegoPacksHome} />
      <Route path="/lego-packs/detalle/:slug" component={LegoPackDetail} />
      <Route path="/lego-packs/:category" component={LegoPacksList} />
      <Route path="/hotel" component={Hotel} />
      <Route path="/hotel/:slug" component={HotelRoom} />
      <Route path="/spa" component={Spa} />
      <Route path="/spa/:slug" component={SpaDetail} />
      <Route path="/restaurantes" component={Restaurantes} />
      <Route path="/restaurantes/reserva-ok" component={RestauranteReservaOk} />
      <Route path="/restaurantes/reserva-ko" component={RestauranteReservaKo} />
      <Route path="/restaurantes/:slug" component={RestauranteDetail} />
      <Route path="/restaurantes/:slug/reservar" component={RestaurantBooking} />
      {/* ── CHECKOUT ROUTE ── */}
      <Route path="/checkout" component={Checkout} />
      {/* ── RESERVA ROUTES ── */}
      <Route path="/reserva/ok" component={ReservaOk} />
      <Route path="/reserva/error" component={ReservaError} />
      {/* ── AUTH ROUTES ── */}
      <Route path="/login" component={Login} />
      <Route path="/recuperar-contrasena" component={ForgotPassword} />
      <Route path="/nueva-contrasena" component={ResetPassword} />
      <Route path="/establecer-contrasena" component={SetPassword} />
      {/* ── LEGAL PAGES ── */}
      <Route path="/privacidad" component={PoliticaPrivacidad} />
      <Route path="/terminos" component={TerminosCondiciones} />
      <Route path="/cookies" component={PoliticaCookies} />
      <Route path="/condiciones-cancelacion" component={CondicionesCancelacion} />
      {/* ── DYNAMIC PAGES (CMS) ── */}
      <Route path="/pagina/:slug" component={DynamicPage} />

      {/* ── ADMIN ROUTES (lazy loaded) ── */}
      <Route path="/admin">
        {() => (
          <Suspense fallback={<AdminLoadingFallback />}>
            <AdminDashboard />
          </Suspense>
        )}
      </Route>

      {/* CMS */}
      <Route path="/admin/cms">{() => <Suspense fallback={<AdminLoadingFallback />}><SlideshowManager /></Suspense>}</Route>
      <Route path="/admin/cms/slideshow">{() => <Suspense fallback={<AdminLoadingFallback />}><SlideshowManager /></Suspense>}</Route>
      <Route path="/admin/cms/menus">{() => <Suspense fallback={<AdminLoadingFallback />}><MenusManager /></Suspense>}</Route>
      <Route path="/admin/cms/paginas">{() => <Suspense fallback={<AdminLoadingFallback />}><PagesManager /></Suspense>}</Route>
      <Route path="/admin/cms/multimedia">{() => <Suspense fallback={<AdminLoadingFallback />}><MultimediaManager /></Suspense>}</Route>
      <Route path="/admin/cms/modulos-home">{() => <Suspense fallback={<AdminLoadingFallback />}><HomeModulesManager /></Suspense>}</Route>
      <Route path="/admin/cms/galeria">{() => <Suspense fallback={<AdminLoadingFallback />}><GalleryManager /></Suspense>}</Route>

      {/* Products */}
      <Route path="/admin/productos">{() => <Suspense fallback={<AdminLoadingFallback />}><ExperiencesManager /></Suspense>}</Route>
      <Route path="/admin/productos/experiencias">{() => <Suspense fallback={<AdminLoadingFallback />}><ExperiencesManager /></Suspense>}</Route>
      <Route path="/admin/productos/categorias">{() => <Suspense fallback={<AdminLoadingFallback />}><CategoriesManager /></Suspense>}</Route>
      <Route path="/admin/productos/ubicaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><LocationsManager /></Suspense>}</Route>
      <Route path="/admin/productos/variantes">{() => <Suspense fallback={<AdminLoadingFallback />}><VariantsManager /></Suspense>}</Route>
      <Route path="/admin/productos/lego-packs">{() => <Suspense fallback={<AdminLoadingFallback />}><LegoPacksManager /></Suspense>}</Route>

      {/* Quotes & Leads — redirigido al nuevo CRM */}
      <Route path="/admin/presupuestos">{() => { window.location.replace("/admin/crm"); return null; }}</Route>
      <Route path="/admin/presupuestos/leads">{() => { window.location.replace("/admin/crm"); return null; }}</Route>
      <Route path="/admin/presupuestos/lista">{() => { window.location.replace("/admin/crm"); return null; }}</Route>
      <Route path="/admin/presupuestos/nuevo">{() => { window.location.replace("/admin/crm"); return null; }}</Route>

      {/* Operations */}
      <Route path="/admin/operaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><CalendarView /></Suspense>}</Route>
      <Route path="/admin/operaciones/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><CalendarView /></Suspense>}</Route>
      <Route path="/admin/operaciones/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><BookingsList /></Suspense>}</Route>
      <Route path="/admin/operaciones/ordenes">{() => <Suspense fallback={<AdminLoadingFallback />}><DailyOrders /></Suspense>}</Route>
      <Route path="/admin/operaciones/reservas-redsys">{() => { window.location.replace("/admin/crm?tab=reservations"); return null; }}</Route>

      {/* Accounting */}
      <Route path="/admin/contabilidad">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingDashboard /></Suspense>}</Route>
      <Route path="/admin/contabilidad/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingDashboard /></Suspense>}</Route>
      <Route path="/admin/contabilidad/transacciones">{() => <Suspense fallback={<AdminLoadingFallback />}><TransactionsList /></Suspense>}</Route>
      <Route path="/admin/contabilidad/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingReports /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpensesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/categorias">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpenseCategoriesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/proveedores">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpenseSuppliersManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/recurrentes">{() => <Suspense fallback={<AdminLoadingFallback />}><RecurringExpensesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/cuenta-resultados">{() => <Suspense fallback={<AdminLoadingFallback />}><ProfitLossReport /></Suspense>}</Route>

      {/* Fiscal REAV */}
      <Route path="/admin/fiscal">{() => <Suspense fallback={<AdminLoadingFallback />}><ReavManager /></Suspense>}</Route>
      <Route path="/admin/fiscal/reav">{() => <Suspense fallback={<AdminLoadingFallback />}><ReavManager /></Suspense>}</Route>

      {/* Marketing */}
      <Route path="/admin/marketing">{() => <Suspense fallback={<AdminLoadingFallback />}><CuponesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/cupones">{() => <Suspense fallback={<AdminLoadingFallback />}><CuponesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/plataformas">{() => <Suspense fallback={<AdminLoadingFallback />}><PlatformsManager /></Suspense>}</Route>
      <Route path="/admin/marketing/descuentos">{() => <Suspense fallback={<AdminLoadingFallback />}><DiscountCodesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/codigos-descuento">{() => <Suspense fallback={<AdminLoadingFallback />}><DiscountCodesManager /></Suspense>}</Route>

      {/* Suppliers & Settlements */}
      <Route path="/admin/suppliers">{() => <Suspense fallback={<AdminLoadingFallback />}><SuppliersManager /></Suspense>}</Route>
      <Route path="/admin/settlements">{() => <Suspense fallback={<AdminLoadingFallback />}><SettlementsManager /></Suspense>}</Route>

      {/* TPV */}
      <Route path="/admin/tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvScreen /></Suspense>}</Route>
      <Route path="/admin/tpv/cajas">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvBackoffice /></Suspense>}</Route>
      <Route path="/admin/tpv/backoffice">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvBackoffice /></Suspense>}</Route>

      {/* Hotel & SPA */}
      <Route path="/admin/hotel">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelManager /></Suspense>}</Route>
      <Route path="/admin/spa">{() => <Suspense fallback={<AdminLoadingFallback />}><SpaManager /></Suspense>}</Route>

      {/* Reviews */}
      <Route path="/admin/operaciones/resenas">{() => <Suspense fallback={<AdminLoadingFallback />}><ReviewsManager /></Suspense>}</Route>

      {/* Restaurants Admin */}
      <Route path="/admin/restaurantes">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurantes/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurantes/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><GlobalCalendar /></Suspense>}</Route>
      <Route path="/admin/restaurantes/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>

      {/* CRM */}
      <Route path="/admin/crm">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/plantillas-email">{() => <Suspense fallback={<AdminLoadingFallback />}><EmailTemplatesManager /></Suspense>}</Route>
      <Route path="/admin/crm/leads">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/presupuestos">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/clientes">{() => <Suspense fallback={<AdminLoadingFallback />}><ClientsManager /></Suspense>}</Route>

      {/* Users & Settings */}
      <Route path="/admin/usuarios">{() => <Suspense fallback={<AdminLoadingFallback />}><UsersManager /></Suspense>}</Route>
      <Route path="/admin/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><Settings /></Suspense>}</Route>

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
          <CookieBanner />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
