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
import PacksHome from "./pages/PacksHome";
import PacksList from "./pages/PacksList";
import PackDetail from "./pages/PackDetail";
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

// Admin pages
import AdminDashboard from "./pages/admin/AdminDashboard";

// CMS
import SlideshowManager from "./pages/admin/cms/SlideshowManager";
import MenusManager from "./pages/admin/cms/MenusManager";
import PagesManager from "./pages/admin/cms/PagesManager";
import MultimediaManager from "./pages/admin/cms/MultimediaManager";
import HomeModulesManager from "./pages/admin/cms/HomeModulesManager";
import GalleryManager from "./pages/admin/cms/GalleryManager";

// Products
import ExperiencesManager from "./pages/admin/products/ExperiencesManager";
import PacksManager from "./pages/admin/products/PacksManager";
import CategoriesManager from "./pages/admin/products/CategoriesManager";
import LocationsManager from "./pages/admin/products/LocationsManager";
import VariantsManager from "./pages/admin/products/VariantsManager";

// Quotes & Leads
import LeadsManager from "./pages/admin/quotes/LeadsManager";
import QuotesList from "./pages/admin/quotes/QuotesList";
import QuoteBuilder from "./pages/admin/quotes/QuoteBuilder";

// Operations
import CalendarView from "./pages/admin/operations/CalendarView";
import BookingsList from "./pages/admin/operations/BookingsList";
import DailyOrders from "./pages/admin/operations/DailyOrders";
import ReservationsManager from "./pages/admin/operations/ReservationsManager";

// Accounting
import AccountingDashboard from "./pages/admin/accounting/AccountingDashboard";
import TransactionsList from "./pages/admin/accounting/TransactionsList";

// Hotel & SPA
import HotelManager from "./pages/admin/hotel/HotelManager";
import SpaManager from "./pages/admin/spa/SpaManager";
import HotelRoom from "./pages/HotelRoom";
import SpaDetail from "./pages/SpaDetail";
import ReviewsManager from "./pages/admin/ReviewsManager";
import RestaurantBooking from "./pages/RestaurantBooking";

// Restaurants Admin
import RestaurantsManager from "./pages/admin/restaurants/RestaurantsManager";
import GlobalCalendar from "./pages/admin/restaurants/GlobalCalendar";

// Users & Settings
import UsersManager from "./pages/admin/users/UsersManager";
import Settings from "./pages/admin/settings/Settings";

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
      <Route path="/packs" component={PacksHome} />
      <Route path="/packs/:category" component={PacksList} />
      <Route path="/packs/:category/:slug" component={PackDetail} />
      <Route path="/hotel" component={Hotel} />
      <Route path="/hotel/:slug" component={HotelRoom} />
      <Route path="/spa" component={Spa} />
      <Route path="/spa/:slug" component={SpaDetail} />
      <Route path="/restaurantes" component={Restaurantes} />
      <Route path="/restaurantes/reserva-ok" component={RestauranteReservaOk} />
      <Route path="/restaurantes/reserva-ko" component={RestauranteReservaKo} />
      <Route path="/restaurantes/:slug" component={RestauranteDetail} />
      <Route path="/restaurantes/:slug/reservar" component={RestaurantBooking} />
      {/* ── RESERVA ROUTES ── */}
      <Route path="/reserva/ok" component={ReservaOk} />
      <Route path="/reserva/error" component={ReservaError} />
      {/* ── AUTH ROUTES ── */}
      <Route path="/login" component={Login} />
      <Route path="/recuperar-contrasena" component={ForgotPassword} />
      <Route path="/nueva-contrasena" component={ResetPassword} />
      <Route path="/establecer-contrasena" component={SetPassword} />
      {/* ── DYNAMIC PAGES (CMS) ── */}
      <Route path="/pagina/:slug" component={DynamicPage} />

      {/* ── ADMIN ROUTES ── */}
      <Route path="/admin" component={AdminDashboard} />

      {/* CMS */}
      <Route path="/admin/cms" component={SlideshowManager} />
      <Route path="/admin/cms/slideshow" component={SlideshowManager} />
      <Route path="/admin/cms/menus" component={MenusManager} />
      <Route path="/admin/cms/paginas" component={PagesManager} />
      <Route path="/admin/cms/multimedia" component={MultimediaManager} />
      <Route path="/admin/cms/modulos-home" component={HomeModulesManager} />
      <Route path="/admin/cms/galeria" component={GalleryManager} />

      {/* Products */}
      <Route path="/admin/productos" component={ExperiencesManager} />
      <Route path="/admin/productos/experiencias" component={ExperiencesManager} />
      <Route path="/admin/productos/packs" component={PacksManager} />
      <Route path="/admin/productos/categorias" component={CategoriesManager} />
      <Route path="/admin/productos/ubicaciones" component={LocationsManager} />
      <Route path="/admin/productos/variantes" component={VariantsManager} />

      {/* Quotes & Leads */}
      <Route path="/admin/presupuestos" component={LeadsManager} />
      <Route path="/admin/presupuestos/leads" component={LeadsManager} />
      <Route path="/admin/presupuestos/lista" component={QuotesList} />
      <Route path="/admin/presupuestos/nuevo" component={QuoteBuilder} />

      {/* Operations */}
      <Route path="/admin/operaciones" component={CalendarView} />
      <Route path="/admin/operaciones/calendario" component={CalendarView} />
      <Route path="/admin/operaciones/reservas" component={BookingsList} />
      <Route path="/admin/operaciones/ordenes" component={DailyOrders} />
      <Route path="/admin/operaciones/reservas-redsys" component={ReservationsManager} />

      {/* Accounting */}
      <Route path="/admin/contabilidad" component={AccountingDashboard} />
      <Route path="/admin/contabilidad/dashboard" component={AccountingDashboard} />
      <Route path="/admin/contabilidad/transacciones" component={TransactionsList} />

      {/* Hotel & SPA */}
      <Route path="/admin/hotel" component={HotelManager} />
      <Route path="/admin/spa" component={SpaManager} />

      {/* Reviews */}
      <Route path="/admin/operaciones/resenas" component={ReviewsManager} />

      {/* Restaurants Admin */}
      <Route path="/admin/restaurantes" component={RestaurantsManager} />
      <Route path="/admin/restaurantes/reservas" component={RestaurantsManager} />
      <Route path="/admin/restaurantes/calendario" component={GlobalCalendar} />
      <Route path="/admin/restaurantes/configuracion" component={RestaurantsManager} />

      {/* Users & Settings */}
      <Route path="/admin/usuarios" component={UsersManager} />
      <Route path="/admin/configuracion" component={Settings} />

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
