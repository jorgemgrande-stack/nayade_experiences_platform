import { lazy, Suspense } from "react";
import ScrollToTop from "./components/ScrollToTop";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import CookieBanner from "./components/CookieBanner";
import MaintenanceGate from "./components/MaintenanceGate";
import { MetaPixelLoader } from "./components/MetaPixelLoader";
import { GA4Loader } from "./components/GA4Loader";
import { ThemeProvider } from "./contexts/ThemeContext";
import { HomeGate, PageOrDefault, SingleOnlyPage, SiteRouteGate, SlugGate, TenantThemeLoader } from "./components/TenantTheme";
import AdminRouteGate from "./components/admin/AdminRouteGate";

// ── PUBLIC PAGES (carga inmediata — visibles sin autenticación) ──────────────
import Home from "./pages/Home";
import TenantHome from "./pages/TenantHome";
import Experiences from "./pages/Experiences";
import ExperienceDetail from "./pages/ExperienceDetail";
import Shop from "./pages/Shop";
import ProductDetail from "./pages/ProductDetail";
import { CatalogRoute } from "./components/StorefrontRoute";
import Gallery from "./pages/Gallery";
import BudgetRequest from "./pages/BudgetRequest";
import Colegios from "./pages/Colegios";
import TenantGroups from "./pages/TenantGroups";
import CanjearCupon from "./pages/CanjearCupon";
import VerificarBono from "./pages/VerificarBono";
import RegistrarGasto from "./pages/RegistrarGasto";
import Contact from "./pages/Contact";
import Locations from "./pages/Locations";
import TenantLocations from "./pages/TenantLocations";
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
import ProposalView from "./pages/ProposalView";
import HotelRoom from "./pages/HotelRoom";
import SpaDetail from "./pages/SpaDetail";
import RestaurantBooking from "./pages/RestaurantBooking";
import Checkout from "./pages/Checkout";
import PoliticaPrivacidad from "./pages/PoliticaPrivacidad";
import TerminosCondiciones from "./pages/TerminosCondiciones";
import PoliticaCookies from "./pages/PoliticaCookies";
import CondicionesCancelacion from "./pages/CondicionesCancelacion";
import Blog from "./pages/Blog";
import BlogPost from "./pages/BlogPost";

// ── ADMIN PAGES (lazy — solo se cargan cuando el usuario navega a /admin) ────
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard"));

// CMS
const SlideshowManager = lazy(() => import("./pages/admin/cms/SlideshowManager"));
const MenusManager = lazy(() => import("./pages/admin/cms/MenusManager"));
const PagesManager = lazy(() => import("./pages/admin/cms/PagesManager"));
const PagePreview = lazy(() => import("./pages/admin/cms/PagePreview"));
const StudioPage = lazy(() => import("./pages/admin/studio/StudioPage"));
const StudioCanvas = lazy(() => import("./pages/admin/studio/StudioCanvas"));
const MultimediaManager = lazy(() => import("./pages/admin/cms/MultimediaManager"));
const HomeModulesManager = lazy(() => import("./pages/admin/cms/HomeModulesManager"));
const GalleryManager = lazy(() => import("./pages/admin/cms/GalleryManager"));
const BlogManager = lazy(() => import("./pages/admin/cms/BlogManager"));

// Products
const ExperiencesManager = lazy(() => import("./pages/admin/products/ExperiencesManager"));
const CategoriesManager = lazy(() => import("./pages/admin/products/CategoriesManager"));
const LocationsManager = lazy(() => import("./pages/admin/products/LocationsManager"));
const VariantsManager = lazy(() => import("./pages/admin/products/VariantsManager"));
const LegoPacksManager = lazy(() => import("./pages/admin/products/LegoPacksManager"));

// Operations
const CalendarView = lazy(() => import("./pages/admin/operations/CalendarView"));
const BookingsList = lazy(() => import("./pages/admin/operations/BookingsList"));
const DailyActivities = lazy(() => import("./pages/admin/operations/DailyActivities"));
const HRDashboard = lazy(() => import("./pages/admin/hr/HRDashboard"));
const EmployeesList = lazy(() => import("./pages/admin/hr/EmployeesList"));
const EmployeeDetail = lazy(() => import("./pages/admin/hr/EmployeeDetail"));
const TimeClockManager = lazy(() => import("./pages/admin/hr/TimeClockManager"));
// Fase 5 RRHH — Nóminas y Remesas
const PayslipsManager = lazy(() => import("./pages/admin/hr/PayslipsManager"));
const PayrollBatchesManager = lazy(() => import("./pages/admin/hr/PayrollBatchesManager"));
const BatchDetail = lazy(() => import("./pages/admin/hr/BatchDetail"));
const HRSettings = lazy(() => import("./pages/admin/hr/HRSettings"));
// Fase 6 RRHH — Bonus
const BonusManager = lazy(() => import("./pages/admin/hr/BonusManager"));
// Fase 7 RRHH — Fiscal
const HRFiscalLedger = lazy(() => import("./pages/admin/hr/HRFiscalLedger"));
// Gestoría e Impuestos
const GestoriaDashboard = lazy(() => import("./pages/admin/gestoria/GestoriaDashboard"));
const GestoriaCalendario = lazy(() => import("./pages/admin/gestoria/GestoriaCalendario"));
const GestoriaConfiguracion = lazy(() => import("./pages/admin/gestoria/GestoriaConfiguracion"));
const GestoriaIVA = lazy(() => import("./pages/admin/gestoria/GestoriaIVA"));
const GestoriaLaboral = lazy(() => import("./pages/admin/gestoria/GestoriaLaboral"));
const GestoriaSociedades = lazy(() => import("./pages/admin/gestoria/GestoriaSociedades"));
const GestoriaExpedientes = lazy(() => import("./pages/admin/gestoria/GestoriaExpedientes"));
const GestoriaAplazamientos = lazy(() => import("./pages/admin/gestoria/GestoriaAplazamientos"));
const GestoriaPortal = lazy(() => import("./pages/gestoria/GestoriaPortal"));
const ActivarGestoria = lazy(() => import("./pages/gestoria/ActivarGestoria"));
// Fase 8 RRHH — Vacaciones
const LeaveManager = lazy(() => import("./pages/admin/hr/LeaveManager"));
const MyLeaves = lazy(() => import("./pages/employee/MyLeaves"));
// Portal del Empleado (Fase 3 RRHH)
const EmployeePortal = lazy(() => import("./pages/employee/EmployeePortal"));
const MyProfile = lazy(() => import("./pages/employee/MyProfile"));
const MyDocuments = lazy(() => import("./pages/employee/MyDocuments"));
const MyTimeClock = lazy(() => import("./pages/employee/MyTimeClock"));
const MyPayslips = lazy(() => import("./pages/employee/MyPayslips"));
const ActivarEmpleado = lazy(() => import("./pages/employee/ActivarEmpleado"));
const MyClasses = lazy(() => import("./pages/employee/MyClasses"));

// Accounting
const AccountingDashboard = lazy(() => import("./pages/admin/accounting/AccountingDashboard"));
const DailyControlCenter = lazy(() => import("./pages/admin/accounting/DailyControlCenter"));
const TransactionsList = lazy(() => import("./pages/admin/accounting/TransactionsList"));
const AccountingReports = lazy(() => import("./pages/admin/accounting/AccountingReports"));
const ExpensesManager = lazy(() => import("./pages/admin/accounting/ExpensesManager"));
const ExpenseCategoriesManager = lazy(() => import("./pages/admin/accounting/ExpenseCategoriesManager"));
const ExpenseSuppliersManager = lazy(() => import("./pages/admin/accounting/ExpenseSuppliersManager"));
const CostCentersManager = lazy(() => import("./pages/admin/accounting/CostCentersManager"));
const CashRegisterManager = lazy(() => import("./pages/admin/accounting/CashRegisterManager"));
const RecurringExpensesManager = lazy(() => import("./pages/admin/accounting/RecurringExpensesManager"));
const ProfitLossReport = lazy(() => import("./pages/admin/accounting/ProfitLossReport"));
const BankMovementsManager = lazy(() => import("./pages/admin/accounting/BankMovementsManager"));
const FinanceSyncSetup = lazy(() => import("./pages/admin/accounting/FinanceSyncSetup"));
const CardTerminalOperationsManager = lazy(() => import("./pages/admin/accounting/CardTerminalOperationsManager"));
const CardTerminalBatchesManager = lazy(() => import("./pages/admin/accounting/CardTerminalBatchesManager"));
const CardTerminalConciliationDashboard = lazy(() => import("./pages/admin/accounting/CardTerminalConciliationDashboard"));

// Hotel & SPA
const HotelManager = lazy(() => import("./pages/admin/hotel/HotelManager"));
const HotelReception = lazy(() => import("./pages/admin/hotel/HotelReception"));
const HotelPlanning = lazy(() => import("./pages/admin/hotel/HotelPlanning"));
const HotelReservations = lazy(() => import("./pages/admin/hotel/HotelReservations"));
const HotelRooms = lazy(() => import("./pages/admin/hotel/HotelRooms"));
const HotelReports = lazy(() => import("./pages/admin/hotel/HotelReports"));
const HotelHousekeeping = lazy(() => import("./pages/admin/hotel/HotelHousekeeping"));
const HotelGuests = lazy(() => import("./pages/admin/hotel/HotelGuests"));
const HotelRatePlans = lazy(() => import("./pages/admin/hotel/HotelRatePlans"));
const HotelIcal = lazy(() => import("./pages/admin/hotel/HotelIcal"));
const SpaManager = lazy(() => import("./pages/admin/spa/SpaManager"));
const CareNetReservas = lazy(() => import("./pages/admin/careNet/Reservas"));
const CareNetBonos = lazy(() => import("./pages/admin/careNet/Bonos"));
const CareNetClientes = lazy(() => import("./pages/admin/careNet/Clientes"));
const ReviewsManager = lazy(() => import("./pages/admin/ReviewsManager"));

// Restaurants Admin
const RestaurantsManager = lazy(() => import("./pages/admin/restaurants/RestaurantsManager"));
const GlobalCalendar = lazy(() => import("./pages/admin/restaurants/GlobalCalendar"));
const RestaurantNetSala = lazy(() => import("./pages/admin/restaurantNet/Sala"));
const RestaurantNetComanda = lazy(() => import("./pages/admin/restaurantNet/Comanda"));
const RestaurantNetCarta = lazy(() => import("./pages/admin/restaurantNet/Carta"));
const RestaurantNetSalasMesas = lazy(() => import("./pages/admin/restaurantNet/SalasMesas"));
const RestaurantNetCocina = lazy(() => import("./pages/admin/restaurantNet/Cocina"));
const RestaurantNetCocinaAjustes = lazy(() => import("./pages/admin/restaurantNet/CocinaAjustes"));

// Users & Settings
const UsersManager = lazy(() => import("./pages/admin/users/UsersManager"));
const MiCuenta = lazy(() => import("./pages/admin/MiCuenta"));
const VerifyEmailChange = lazy(() => import("./pages/VerifyEmailChange"));
const Settings = lazy(() => import("./pages/admin/settings/Settings"));
const BrandTheme = lazy(() => import("./pages/admin/settings/BrandTheme"));
const CustomDomains = lazy(() => import("./pages/admin/settings/CustomDomains"));
const IntegrationsSettings = lazy(() => import("./pages/admin/settings/Integrations"));
const PostmarkSettings = lazy(() => import("./pages/admin/settings/PostmarkSettings"));
const AdvancedSettings = lazy(() => import("./pages/admin/settings/AdvancedSettings"));
const SitesManager = lazy(() => import("./pages/admin/settings/SitesManager"));
const ConfigPanel = lazy(() => import("./pages/admin/settings/ConfigPanel"));
const ConfigStatus = lazy(() => import("./pages/admin/settings/ConfigStatus"));
const OnboardingWizard = lazy(() => import("./pages/admin/onboarding/OnboardingWizard"));
const SubscriptionPage = lazy(() => import("./pages/admin/subscription/SubscriptionPage"));
const DataExportPage = lazy(() => import("./pages/admin/subscription/DataExportPage"));
const ModulesPage = lazy(() => import("./pages/admin/subscription/ModulesPage"));
const UsagePage = lazy(() => import("./pages/admin/subscription/UsagePage"));
const ConnectPage = lazy(() => import("./pages/admin/connect/ConnectPage"));
const ConnectDetailPage = lazy(() => import("./pages/admin/connect/ConnectDetailPage"));
const HelpCenter = lazy(() => import("./pages/admin/help/HelpCenter"));
const SupportTicketsPage = lazy(() => import("./pages/admin/help/SupportTicketsPage"));
const PrimerosPasos = lazy(() => import("./pages/admin/setup/PrimerosPasos"));

// CRM
const CRMDashboard = lazy(() => import("./pages/admin/crm/CRMDashboard"));
const ClientsManager = lazy(() => import("./pages/admin/crm/ClientsManager"));
const ClientDetail = lazy(() => import("./pages/admin/crm/ClientDetail"));
const OnlineOrdersList = lazy(() => import("./pages/admin/shop/OnlineOrders"));
const OnlineOrderDetail = lazy(() => import("./pages/admin/shop/OnlineOrders").then((m) => ({ default: m.OnlineOrderDetail })));
const CrmTags = lazy(() => import("./pages/admin/crm/CrmTags"));
const CrmTasks = lazy(() => import("./pages/admin/crm/CrmTasks"));
const CrmFunnel = lazy(() => import("./pages/admin/crm/CrmFunnel"));
const PricingRules = lazy(() => import("./pages/admin/products/PricingRules"));
const InventoryManager = lazy(() => import("./pages/admin/products/Inventory"));
const CommunitiesManager = lazy(() => import("./pages/admin/communities/CommunitiesManager"));
const CommunityDetail = lazy(() => import("./pages/admin/communities/CommunityDetail"));
const MyCommunities = lazy(() => import("./pages/community/MyCommunities"));
const CommunityHub = lazy(() => import("./pages/community/CommunityHub"));
const ActivateMember = lazy(() => import("./pages/community/ActivateMember"));
const LoyaltyManager = lazy(() => import("./pages/admin/loyalty/Loyalty"));
const SocialTokenNetHome = lazy(() => import("./pages/admin/socialTokenNet/SocialTokenNetHome"));
const NetProductHome = lazy(() => import("./pages/admin/net/NetProductHome"));
const LifeHome = lazy(() => import("./pages/admin/lifeNet/LifeHome"));
const LifeAgenda = lazy(() => import("./pages/admin/lifeNet/LifeAgenda"));
const LifeTasks = lazy(() => import("./pages/admin/lifeNet/LifeTasks"));
const LifeTracking = lazy(() => import("./pages/admin/lifeNet/LifeTracking"));
const LifeMembers = lazy(() => import("./pages/admin/lifeNet/LifeMembers"));
const ContractsList = lazy(() => import("./pages/admin/contratos/ContractsList"));
const ContractTemplates = lazy(() => import("./pages/admin/contratos/ContractTemplates"));
const ContractDetail = lazy(() => import("./pages/admin/contratos/ContractDetail"));
const SkiSchoolPlanning = lazy(() => import("./pages/admin/ski/SkiSchoolPlanning"));
const SkiInstructors = lazy(() => import("./pages/admin/ski/SkiInstructors"));
const TravelFiles = lazy(() => import("./pages/admin/travel/TravelFiles"));
const TravelSuppliers = lazy(() => import("./pages/admin/travel/TravelSuppliers"));
const TravelOperations = lazy(() => import("./pages/admin/travel/TravelOperations"));
const TravelMargins = lazy(() => import("./pages/admin/travel/TravelMargins"));
const RestaurantReports = lazy(() => import("./pages/admin/netReports/RestaurantReports"));
const CareReports = lazy(() => import("./pages/admin/netReports/CareReports"));
const SkiReports = lazy(() => import("./pages/admin/netReports/SkiReports"));
const TravelReports = lazy(() => import("./pages/admin/netReports/TravelReports"));
const SkiTeachingProducts = lazy(() => import("./pages/admin/ski/SkiTeachingProducts"));
const SkiSessions = lazy(() => import("./pages/admin/ski/SkiSessions"));
const SkiGroups = lazy(() => import("./pages/admin/ski/SkiGroups"));
const SkiRentalCounter = lazy(() => import("./pages/admin/ski/SkiRentalCounter"));
const SkiRentalInventory = lazy(() => import("./pages/admin/ski/SkiRentalInventory"));
const SkiRentalWorkshop = lazy(() => import("./pages/admin/ski/SkiRentalWorkshop"));
const SkiRentalSettings = lazy(() => import("./pages/admin/ski/SkiRentalSettings"));
const SkiTeacherHours = lazy(() => import("./pages/admin/ski/SkiTeacherHours"));
const SkiSettlements = lazy(() => import("./pages/admin/ski/SkiSettlements"));
const ProposalsPage = lazy(() => import("./pages/admin/crm/ProposalsPage"));
const CommercialFollowupDashboard = lazy(() => import("./pages/admin/commercial/CommercialFollowupDashboard"));
const WhatsAppGHLInbox = lazy(() => import("./pages/admin/commercial/WhatsAppGHLInbox"));
const VapiAgente = lazy(() => import("./pages/admin/commercial/VapiAgente"));
const ReceptionAi = lazy(() => import("./pages/admin/commercial/ReceptionAi"));
const Copilot = lazy(() => import("./pages/admin/Copilot"));
const EmailInbox = lazy(() => import("./pages/admin/commercial/EmailInbox"));
const EmailAccountsSettings = lazy(() => import("./pages/admin/settings/EmailAccountsSettings"));
const SolicitarAnulacion = lazy(() => import("./pages/SolicitarAnulacion"));

// Fiscal REAV
const ReavManager = lazy(() => import("./pages/admin/fiscal/ReavManager"));

// Partners (admin)
const PartnersManager = lazy(() => import("./pages/admin/partners/PartnersManager"));
const PartnerBillingManager = lazy(() => import("./pages/admin/partners/PartnerBillingManager"));

// Partner portal (lazy)
const ActivarPartner = lazy(() => import("./pages/partner/ActivarPartner"));
const PartnerDashboard = lazy(() => import("./pages/partner/PartnerDashboard"));
const PartnerLeadNuevo = lazy(() => import("./pages/partner/PartnerLeadNuevo"));
const PartnerReservaNueva = lazy(() => import("./pages/partner/PartnerReservaNueva"));

// Supplier portal (lazy)
const SupplierDashboard = lazy(() => import("./pages/supplier/SupplierDashboard"));
const ActivarProveedor = lazy(() => import("./pages/supplier/ActivarProveedor"));

// Suppliers & Settlements
const SuppliersManager = lazy(() => import("./pages/admin/suppliers/SuppliersManager"));
const SettlementsManager = lazy(() => import("./pages/admin/suppliers/SettlementsManager"));

// Marketing
const DiscountCodesManager = lazy(() => import("./pages/DiscountCodesManager"));
const CuponesManager = lazy(() => import("./pages/admin/marketing/CuponesManager"));
const BrevoMarketing = lazy(() => import("./pages/admin/marketing/BrevoMarketing"));
const Campanas = lazy(() => import("./pages/admin/marketing/Campanas"));
const GeoControl = lazy(() => import("./pages/admin/marketing/GeoControl"));
const SeoControl = lazy(() => import("./pages/admin/marketing/SeoControl"));
const AdsManager = lazy(() => import("./pages/admin/marketing/AdsManager"));
const GeneralAccounting = lazy(() => import("./pages/admin/accounting/GeneralAccounting"));
const PlatformsManager = lazy(() => import("./pages/admin/marketing/PlatformsManager"));

// TPV
const TpvScreen = lazy(() => import("./pages/admin/tpv/TpvScreen"));
const TpvBackoffice = lazy(() => import("./pages/admin/tpv/TpvBackoffice"));
const TpvReports = lazy(() => import("./pages/admin/tpv/TpvReports"));

// Plantillas Email
const EmailTemplatesManager = lazy(() => import("./pages/admin/EmailTemplatesManager"));
const PdfTemplatesManager = lazy(() => import("./pages/admin/PdfTemplatesManager"));

// Series de numeración
const DocumentNumbersAdmin = lazy(() => import("./pages/admin/DocumentNumbersAdmin"));

// Fallback de carga para páginas admin
function AdminLoadingFallback() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center" role="status" aria-label="Cargando">
      <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function Router() {
  return (
    <AdminRouteGate>
    <Switch>
      {/* ── PUBLIC ROUTES ── */}
      <Route path="/">{() => <HomeGate Fallback={Home} Tenant={TenantHome} />}</Route>
      {/* Catálogo: ficha sectorial (instalación propia) o de tienda (pyme); cada empresa, en su dirección */}
      <Route path="/experiencias">{() => <CatalogRoute Sector={Experiences} Generic={Shop} />}</Route>
      <Route path="/experiencias/:slug">{() => <CatalogRoute Sector={ExperienceDetail} Generic={ProductDetail} />}</Route>
      <Route path="/tienda">{() => <CatalogRoute Sector={Experiences} Generic={Shop} />}</Route>
      <Route path="/tienda/:slug">{() => <CatalogRoute Sector={ExperienceDetail} Generic={ProductDetail} />}</Route>
      <Route path="/galeria" component={Gallery} />
      <Route path="/presupuesto">{() => <SiteRouteGate><BudgetRequest /></SiteRouteGate>}</Route>
      <Route path="/colegios">{() => <SingleOnlyPage Single={Colegios} slug="colegios" Tenant={TenantGroups} />}</Route>
      <Route path="/grupos">{() => <SingleOnlyPage Single={Colegios} slug="colegios" Tenant={TenantGroups} />}</Route>
      <Route path="/canjear-cupon">{() => <SiteRouteGate><CanjearCupon /></SiteRouteGate>}</Route>
      <Route path="/verificar-bono" component={VerificarBono} />
      <Route path="/registrar-gasto" component={RegistrarGasto} />
      <Route path="/solicitar-anulacion">{() => <Suspense fallback={<AdminLoadingFallback />}><SolicitarAnulacion /></Suspense>}</Route>
      <Route path="/presupuesto/:token" component={QuoteAcceptance} />
      <Route path="/propuesta/:token" component={ProposalView} />
      <Route path="/contacto">{() => <PageOrDefault slug="contacto" Default={Contact} />}</Route>
      <Route path="/ubicaciones">{() => <SingleOnlyPage Single={Locations} slug="ubicaciones" Tenant={TenantLocations} />}</Route>
      <Route path="/ubicaciones/:slug">{() => <SingleOnlyPage Single={Locations} slug="ubicaciones" Tenant={TenantLocations} />}</Route>
      <Route path="/lego-packs">{() => <SiteRouteGate><LegoPacksHome /></SiteRouteGate>}</Route>
      <Route path="/lego-packs/detalle/:slug">{() => <SiteRouteGate><LegoPackDetail /></SiteRouteGate>}</Route>
      <Route path="/lego-packs/:category">{() => <SiteRouteGate><LegoPacksList /></SiteRouteGate>}</Route>
      <Route path="/hotel">{() => <SiteRouteGate><Hotel /></SiteRouteGate>}</Route>
      <Route path="/hotel/:slug">{() => <SiteRouteGate><HotelRoom /></SiteRouteGate>}</Route>
      <Route path="/spa">{() => <SiteRouteGate><Spa /></SiteRouteGate>}</Route>
      <Route path="/spa/:slug">{() => <SiteRouteGate><SpaDetail /></SiteRouteGate>}</Route>
      <Route path="/restaurantes">{() => <SiteRouteGate><Restaurantes /></SiteRouteGate>}</Route>
      <Route path="/restaurantes/reserva-ok">{() => <SiteRouteGate><RestauranteReservaOk /></SiteRouteGate>}</Route>
      <Route path="/restaurantes/reserva-ko">{() => <SiteRouteGate><RestauranteReservaKo /></SiteRouteGate>}</Route>
      <Route path="/restaurantes/:slug">{() => <SiteRouteGate><RestauranteDetail /></SiteRouteGate>}</Route>
      <Route path="/restaurantes/:slug/reservar">{() => <SiteRouteGate><RestaurantBooking /></SiteRouteGate>}</Route>
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
      <Route path="/admin/verificar-correo">{() => <Suspense fallback={<AdminLoadingFallback />}><VerifyEmailChange /></Suspense>}</Route>

      {/* ── PARTNER PORTAL ── */}
      <Route path="/partner/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarPartner /></Suspense>}</Route>
      <Route path="/partner/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerDashboard /></Suspense>}</Route>
      <Route path="/partner/leads/nuevo">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerLeadNuevo /></Suspense>}</Route>
      <Route path="/partner/reservas/nueva">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerReservaNueva /></Suspense>}</Route>
      <Route path="/partner">{() => { window.location.replace("/partner/dashboard"); return null; }}</Route>

      {/* Portal de Proveedor */}
      <Route path="/supplier/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarProveedor /></Suspense>}</Route>
      <Route path="/supplier/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><SupplierDashboard /></Suspense>}</Route>
      <Route path="/supplier">{() => { window.location.replace("/supplier/dashboard"); return null; }}</Route>
      {/* ── LEGAL PAGES ── */}
      <Route path="/privacidad">{() => <SingleOnlyPage Single={PoliticaPrivacidad} slug="politica-de-privacidad" />}</Route>
      <Route path="/terminos">{() => <SingleOnlyPage Single={TerminosCondiciones} slug="terminos" />}</Route>
      <Route path="/cookies">{() => <SingleOnlyPage Single={PoliticaCookies} slug="politica-de-cookies" />}</Route>
      <Route path="/condiciones-cancelacion">{() => <SingleOnlyPage Single={CondicionesCancelacion} slug="condiciones-cancelacion" />}</Route>
      {/* ── DYNAMIC PAGES (CMS) ── */}
      <Route path="/pagina/:slug" component={DynamicPage} />
      {/* ── BLOG (entradas publicadas de la empresa) ── */}
      <Route path="/blog" component={Blog} />
      <Route path="/blog/:slug" component={BlogPost} />

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
      <Route path="/admin/cms/paginas/vista-previa/:slug">{(p) => <Suspense fallback={<AdminLoadingFallback />}><PagePreview slug={p.slug} /></Suspense>}</Route>
      <Route path="/admin/cms/paginas">{() => <Suspense fallback={<AdminLoadingFallback />}><PagesManager /></Suspense>}</Route>
      {/* Elephant Studio y su lienzo (se carga dentro del marco del editor) */}
      <Route path="/admin/studio-lienzo">{() => <Suspense fallback={<AdminLoadingFallback />}><StudioCanvas /></Suspense>}</Route>
      <Route path="/admin/studio/:slug">{(p) => <Suspense fallback={<AdminLoadingFallback />}><StudioPage slug={p.slug} /></Suspense>}</Route>
      <Route path="/admin/studio">{() => <Suspense fallback={<AdminLoadingFallback />}><StudioPage /></Suspense>}</Route>
      <Route path="/admin/cms/multimedia">{() => <Suspense fallback={<AdminLoadingFallback />}><MultimediaManager /></Suspense>}</Route>
      <Route path="/admin/cms/modulos-home">{() => <Suspense fallback={<AdminLoadingFallback />}><HomeModulesManager /></Suspense>}</Route>
      <Route path="/admin/cms/galeria">{() => <Suspense fallback={<AdminLoadingFallback />}><GalleryManager /></Suspense>}</Route>
      <Route path="/admin/cms/blog">{() => <Suspense fallback={<AdminLoadingFallback />}><BlogManager /></Suspense>}</Route>

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
      <Route path="/admin/operaciones/actividades">{() => <Suspense fallback={<AdminLoadingFallback />}><DailyActivities /></Suspense>}</Route>
      {/* La gestión de empleados vive 100% en /admin/personal (Fase 10).
          La ruta histórica de Monitores redirige al módulo nuevo. */}
      <Route path="/admin/operaciones/monitores">{() => { window.location.replace("/admin/personal/empleados"); return null; }}</Route>
      <Route path="/admin/operaciones/reservas-redsys">{() => { window.location.replace("/admin/crm?tab=reservations"); return null; }}</Route>

      {/* Personal / RRHH (Fase 2) */}
      <Route path="/admin/personal">{() => <Suspense fallback={<AdminLoadingFallback />}><HRDashboard /></Suspense>}</Route>
      <Route path="/admin/personal/empleados">{() => <Suspense fallback={<AdminLoadingFallback />}><EmployeesList /></Suspense>}</Route>
      <Route path="/admin/personal/empleados/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><EmployeeDetail /></Suspense>}</Route>
      <Route path="/admin/personal/fichajes">{() => <Suspense fallback={<AdminLoadingFallback />}><TimeClockManager /></Suspense>}</Route>
      {/* Fase 5: Nóminas y remesas */}
      <Route path="/admin/personal/nominas">{() => <Suspense fallback={<AdminLoadingFallback />}><PayslipsManager /></Suspense>}</Route>
      <Route path="/admin/personal/remesas">{() => <Suspense fallback={<AdminLoadingFallback />}><PayrollBatchesManager /></Suspense>}</Route>
      <Route path="/admin/personal/remesas/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><BatchDetail /></Suspense>}</Route>
      <Route path="/admin/personal/bonus">{() => <Suspense fallback={<AdminLoadingFallback />}><BonusManager /></Suspense>}</Route>
      <Route path="/admin/personal/fiscal">{() => <Suspense fallback={<AdminLoadingFallback />}><HRFiscalLedger /></Suspense>}</Route>
      <Route path="/admin/personal/vacaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><LeaveManager /></Suspense>}</Route>
      <Route path="/admin/personal/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><HRSettings /></Suspense>}</Route>

      {/* Portal del Empleado (Fase 3) */}
      {/* Social Token Net · Comunidades: área de miembros con la cuenta del Core */}
      <Route path="/comunidad">{() => <Suspense fallback={<AdminLoadingFallback />}><MyCommunities /></Suspense>}</Route>
      <Route path="/comunidad/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivateMember /></Suspense>}</Route>
      <Route path="/comunidad/:slug">{() => <Suspense fallback={<AdminLoadingFallback />}><CommunityHub /></Suspense>}</Route>
      <Route path="/empleado">{() => <Suspense fallback={<AdminLoadingFallback />}><EmployeePortal /></Suspense>}</Route>
      <Route path="/empleado/fichar">{() => <Suspense fallback={<AdminLoadingFallback />}><MyTimeClock /></Suspense>}</Route>
      <Route path="/empleado/perfil">{() => <Suspense fallback={<AdminLoadingFallback />}><MyProfile /></Suspense>}</Route>
      <Route path="/empleado/nominas">{() => <Suspense fallback={<AdminLoadingFallback />}><MyPayslips /></Suspense>}</Route>
      <Route path="/empleado/documentos">{() => <Suspense fallback={<AdminLoadingFallback />}><MyDocuments /></Suspense>}</Route>
      <Route path="/empleado/vacaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><MyLeaves /></Suspense>}</Route>
      <Route path="/empleado/clases">{() => <Suspense fallback={<AdminLoadingFallback />}><MyClasses /></Suspense>}</Route>
      <Route path="/empleado/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarEmpleado /></Suspense>}</Route>

      {/* Accounting */}
      <Route path="/admin/contabilidad/control-diario">{() => <Suspense fallback={<AdminLoadingFallback />}><DailyControlCenter /></Suspense>}</Route>
      <Route path="/admin/contabilidad">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingDashboard /></Suspense>}</Route>
      <Route path="/admin/contabilidad/dashboard">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingDashboard /></Suspense>}</Route>
      <Route path="/admin/contabilidad/transacciones">{() => <Suspense fallback={<AdminLoadingFallback />}><TransactionsList /></Suspense>}</Route>
      <Route path="/admin/contabilidad/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><AccountingReports /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpensesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/categorias">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpenseCategoriesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/proveedores">{() => <Suspense fallback={<AdminLoadingFallback />}><ExpenseSuppliersManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/centros-coste">{() => <Suspense fallback={<AdminLoadingFallback />}><CostCentersManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/gastos/recurrentes">{() => <Suspense fallback={<AdminLoadingFallback />}><RecurringExpensesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/cuenta-resultados">{() => <Suspense fallback={<AdminLoadingFallback />}><ProfitLossReport /></Suspense>}</Route>
      <Route path="/admin/contabilidad/caja">{() => <Suspense fallback={<AdminLoadingFallback />}><CashRegisterManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/finance-sync">{() => <Suspense fallback={<AdminLoadingFallback />}><FinanceSyncSetup /></Suspense>}</Route>
      <Route path="/admin/contabilidad/movimientos-bancarios">{() => <Suspense fallback={<AdminLoadingFallback />}><BankMovementsManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/operaciones-tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><CardTerminalOperationsManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/remesas-tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><CardTerminalBatchesManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/conciliacion-tpv">{() => <Suspense fallback={<AdminLoadingFallback />}><CardTerminalConciliationDashboard /></Suspense>}</Route>

      {/* Fiscal REAV */}
      <Route path="/admin/fiscal">{() => <Suspense fallback={<AdminLoadingFallback />}><ReavManager /></Suspense>}</Route>
      <Route path="/admin/fiscal/reav">{() => <Suspense fallback={<AdminLoadingFallback />}><ReavManager /></Suspense>}</Route>

      {/* Gestoría e Impuestos */}
      <Route path="/admin/gestoria">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaDashboard /></Suspense>}</Route>
      <Route path="/admin/gestoria/iva">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaIVA /></Suspense>}</Route>
      <Route path="/admin/gestoria/laboral">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaLaboral /></Suspense>}</Route>
      <Route path="/admin/gestoria/sociedades">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaSociedades /></Suspense>}</Route>
      <Route path="/admin/gestoria/expedientes">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaExpedientes /></Suspense>}</Route>
      <Route path="/admin/gestoria/aplazamientos">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaAplazamientos /></Suspense>}</Route>

      {/* Portal de Gestoría (rol gestoria, fuera de /admin) */}
      <Route path="/gestoria">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaPortal /></Suspense>}</Route>
      <Route path="/gestoria/activar">{() => <Suspense fallback={<AdminLoadingFallback />}><ActivarGestoria /></Suspense>}</Route>
      <Route path="/admin/gestoria/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaCalendario /></Suspense>}</Route>
      <Route path="/admin/gestoria/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><GestoriaConfiguracion /></Suspense>}</Route>

      {/* Marketing */}
      <Route path="/admin/marketing">{() => <Suspense fallback={<AdminLoadingFallback />}><CuponesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/cupones">{() => <Suspense fallback={<AdminLoadingFallback />}><CuponesManager /></Suspense>}</Route>
      <Route path="/admin/marketing/brevo">{() => <Suspense fallback={<AdminLoadingFallback />}><BrevoMarketing /></Suspense>}</Route>
      <Route path="/admin/marketing/campanas">{() => <Suspense fallback={<AdminLoadingFallback />}><Campanas /></Suspense>}</Route>
      <Route path="/admin/marketing/geo">{() => <Suspense fallback={<AdminLoadingFallback />}><GeoControl /></Suspense>}</Route>
      <Route path="/admin/marketing/seo">{() => <Suspense fallback={<AdminLoadingFallback />}><SeoControl /></Suspense>}</Route>
      <Route path="/admin/marketing/ads">{() => <Suspense fallback={<AdminLoadingFallback />}><AdsManager /></Suspense>}</Route>
      <Route path="/admin/contabilidad/general">{() => <Suspense fallback={<AdminLoadingFallback />}><GeneralAccounting /></Suspense>}</Route>
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
      <Route path="/admin/tpv/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><TpvReports /></Suspense>}</Route>

      {/* Hotel & SPA */}
      <Route path="/admin/hotel/recepcion">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelReception /></Suspense>}</Route>
      <Route path="/admin/hotel/planning">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelPlanning /></Suspense>}</Route>
      <Route path="/admin/hotel/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelReservations /></Suspense>}</Route>
      <Route path="/admin/hotel/habitaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelRooms /></Suspense>}</Route>
      <Route path="/admin/hotel/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelReports /></Suspense>}</Route>
      <Route path="/admin/hotel/housekeeping">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelHousekeeping /></Suspense>}</Route>
      <Route path="/admin/hotel/huespedes">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelGuests /></Suspense>}</Route>
      <Route path="/admin/hotel/tarifas">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelRatePlans /></Suspense>}</Route>
      <Route path="/admin/hotel/canales">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelIcal /></Suspense>}</Route>
      <Route path="/admin/hotel">{() => <Suspense fallback={<AdminLoadingFallback />}><HotelManager /></Suspense>}</Route>
      <Route path="/admin/spa">{() => <Suspense fallback={<AdminLoadingFallback />}><SpaManager /></Suspense>}</Route>
      <Route path="/admin/care-net/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><CareNetReservas /></Suspense>}</Route>
      <Route path="/admin/care-net/bonos">{() => <Suspense fallback={<AdminLoadingFallback />}><CareNetBonos /></Suspense>}</Route>
      <Route path="/admin/care-net/clientes">{() => <Suspense fallback={<AdminLoadingFallback />}><CareNetClientes /></Suspense>}</Route>

      {/* Reviews */}
      <Route path="/admin/operaciones/resenas">{() => <Suspense fallback={<AdminLoadingFallback />}><ReviewsManager /></Suspense>}</Route>

      {/* Restaurants Admin */}
      <Route path="/admin/restaurantes">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurantes/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurantes/calendario">{() => <Suspense fallback={<AdminLoadingFallback />}><GlobalCalendar /></Suspense>}</Route>
      <Route path="/admin/restaurantes/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantsManager /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/sala">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantNetSala /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/sala/comanda/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantNetComanda /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/carta">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantNetCarta /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/salas-mesas">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantNetSalasMesas /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/cocina">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantNetCocina /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/cocina/ajustes">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantNetCocinaAjustes /></Suspense>}</Route>

      {/* Atención Comercial */}
      <Route path="/admin/atencion-comercial/whatsapp">{() => <Suspense fallback={<AdminLoadingFallback />}><WhatsAppGHLInbox /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial/agente-ia">{() => <Suspense fallback={<AdminLoadingFallback />}><VapiAgente /></Suspense>}</Route>
      <Route path="/admin/copilot">{() => <Suspense fallback={<AdminLoadingFallback />}><Copilot /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial/recepcionista">{() => <Suspense fallback={<AdminLoadingFallback />}><ReceptionAi /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial/email">{() => <Suspense fallback={<AdminLoadingFallback />}><EmailInbox /></Suspense>}</Route>
      <Route path="/admin/atencion-comercial">{() => <Suspense fallback={<AdminLoadingFallback />}><CommercialFollowupDashboard /></Suspense>}</Route>

      {/* CRM */}
      <Route path="/admin/crm">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/plantillas-email">{() => <Suspense fallback={<AdminLoadingFallback />}><EmailTemplatesManager /></Suspense>}</Route>
      <Route path="/admin/partners">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnersManager /></Suspense>}</Route>
      <Route path="/admin/partners/facturacion">{() => <Suspense fallback={<AdminLoadingFallback />}><PartnerBillingManager /></Suspense>}</Route>
      <Route path="/admin/crm/leads">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/presupuestos">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/crm/reservas">{() => <Suspense fallback={<AdminLoadingFallback />}><CRMDashboard /></Suspense>}</Route>
      <Route path="/admin/tienda/pedidos/:pedido">{(params) => <Suspense fallback={<AdminLoadingFallback />}><OnlineOrderDetail key={params.pedido} merchantOrder={decodeURIComponent(params.pedido)} /></Suspense>}</Route>
      <Route path="/admin/tienda/pedidos">{() => <Suspense fallback={<AdminLoadingFallback />}><OnlineOrdersList /></Suspense>}</Route>
      <Route path="/admin/crm/clientes/:id">{(params) => <Suspense fallback={<AdminLoadingFallback />}><ClientDetail key={params.id} id={Number(params.id)} /></Suspense>}</Route>
      <Route path="/admin/crm/clientes">{() => <Suspense fallback={<AdminLoadingFallback />}><ClientsManager /></Suspense>}</Route>
      <Route path="/admin/crm/etiquetas">{() => <Suspense fallback={<AdminLoadingFallback />}><CrmTags /></Suspense>}</Route>
      <Route path="/admin/crm/tareas">{() => <Suspense fallback={<AdminLoadingFallback />}><CrmTasks /></Suspense>}</Route>
      <Route path="/admin/productos/reglas-precios">{() => <Suspense fallback={<AdminLoadingFallback />}><PricingRules /></Suspense>}</Route>
      <Route path="/admin/productos/inventario">{() => <Suspense fallback={<AdminLoadingFallback />}><InventoryManager /></Suspense>}</Route>
      <Route path="/admin/comunidades">{() => <Suspense fallback={<AdminLoadingFallback />}><CommunitiesManager /></Suspense>}</Route>
      <Route path="/admin/comunidades/apartado/:tab">{() => <Suspense fallback={<AdminLoadingFallback />}><CommunitiesManager /></Suspense>}</Route>
      <Route path="/admin/comunidades/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><CommunityDetail /></Suspense>}</Route>
      <Route path="/admin/comunidades/:id/:tab">{() => <Suspense fallback={<AdminLoadingFallback />}><CommunityDetail /></Suspense>}</Route>
      <Route path="/admin/fidelizacion">{() => <Suspense fallback={<AdminLoadingFallback />}><LoyaltyManager /></Suspense>}</Route>
      <Route path="/admin/fidelizacion/:tab">{() => <Suspense fallback={<AdminLoadingFallback />}><LoyaltyManager /></Suspense>}</Route>
      <Route path="/admin/social-token-net">{() => <Suspense fallback={<AdminLoadingFallback />}><SocialTokenNetHome /></Suspense>}</Route>
      <Route path="/admin/net/life">{() => <Suspense fallback={<AdminLoadingFallback />}><LifeHome /></Suspense>}</Route>
      <Route path="/admin/life/agenda">{() => <Suspense fallback={<AdminLoadingFallback />}><LifeAgenda /></Suspense>}</Route>
      <Route path="/admin/life/tareas">{() => <Suspense fallback={<AdminLoadingFallback />}><LifeTasks /></Suspense>}</Route>
      <Route path="/admin/life/seguimiento">{() => <Suspense fallback={<AdminLoadingFallback />}><LifeTracking /></Suspense>}</Route>
      <Route path="/admin/life/miembros">{() => <Suspense fallback={<AdminLoadingFallback />}><LifeMembers /></Suspense>}</Route>
      <Route path="/admin/contratos">{() => <Suspense fallback={<AdminLoadingFallback />}><ContractsList /></Suspense>}</Route>
      <Route path="/admin/contratos/plantillas">{() => <Suspense fallback={<AdminLoadingFallback />}><ContractTemplates /></Suspense>}</Route>
      <Route path="/admin/contratos/:id">{(params) => <Suspense fallback={<AdminLoadingFallback />}><ContractDetail key={params.id} id={Number(params.id)} /></Suspense>}</Route>
      <Route path="/admin/net/:producto">{() => <Suspense fallback={<AdminLoadingFallback />}><NetProductHome /></Suspense>}</Route>
      <Route path="/admin/ski/escuela">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiSchoolPlanning /></Suspense>}</Route>
      <Route path="/admin/travel/expedientes">{() => <Suspense fallback={<AdminLoadingFallback />}><TravelFiles /></Suspense>}</Route>
      <Route path="/admin/travel/proveedores">{() => <Suspense fallback={<AdminLoadingFallback />}><TravelSuppliers /></Suspense>}</Route>
      <Route path="/admin/travel/operaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><TravelOperations /></Suspense>}</Route>
      <Route path="/admin/travel/margenes">{() => <Suspense fallback={<AdminLoadingFallback />}><TravelMargins /></Suspense>}</Route>
      <Route path="/admin/travel/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><TravelReports /></Suspense>}</Route>
      <Route path="/admin/restaurant-net/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><RestaurantReports /></Suspense>}</Route>
      <Route path="/admin/care-net/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><CareReports /></Suspense>}</Route>
      <Route path="/admin/ski/informes">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiReports /></Suspense>}</Route>
      <Route path="/admin/ski/profesores">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiInstructors /></Suspense>}</Route>
      <Route path="/admin/ski/productos-docentes">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiTeachingProducts /></Suspense>}</Route>
      <Route path="/admin/ski/sesiones">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiSessions /></Suspense>}</Route>
      <Route path="/admin/ski/grupos">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiGroups /></Suspense>}</Route>
      <Route path="/admin/ski/horas">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiTeacherHours /></Suspense>}</Route>
      <Route path="/admin/ski/liquidaciones">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiSettlements /></Suspense>}</Route>
      <Route path="/admin/ski/alquiler">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiRentalCounter /></Suspense>}</Route>
      <Route path="/admin/ski/inventario">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiRentalInventory /></Suspense>}</Route>
      <Route path="/admin/ski/taller">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiRentalWorkshop /></Suspense>}</Route>
      <Route path="/admin/ski/alquiler-ajustes">{() => <Suspense fallback={<AdminLoadingFallback />}><SkiRentalSettings /></Suspense>}</Route>
      <Route path="/admin/crm/embudo">{() => <Suspense fallback={<AdminLoadingFallback />}><CrmFunnel /></Suspense>}</Route>
      <Route path="/admin/crm/propuestas">{() => <Suspense fallback={<AdminLoadingFallback />}><ProposalsPage /></Suspense>}</Route>
      <Route path="/admin/crm/anulaciones">{() => { window.location.replace("/admin/crm"); return null; }}</Route>

      {/* Users & Settings */}
      <Route path="/admin/usuarios">{() => <Suspense fallback={<AdminLoadingFallback />}><UsersManager /></Suspense>}</Route>
      <Route path="/admin/mi-cuenta">{() => <Suspense fallback={<AdminLoadingFallback />}><MiCuenta /></Suspense>}</Route>
      <Route path="/admin/configuracion">{() => <Suspense fallback={<AdminLoadingFallback />}><ConfigPanel /></Suspense>}</Route>
      <Route path="/admin/configuracion/marca">{() => <Suspense fallback={<AdminLoadingFallback />}><BrandTheme /></Suspense>}</Route>
      <Route path="/admin/configuracion/dominios">{() => <Suspense fallback={<AdminLoadingFallback />}><CustomDomains /></Suspense>}</Route>
      <Route path="/admin/configuracion/integraciones">{() => <Suspense fallback={<AdminLoadingFallback />}><IntegrationsSettings /></Suspense>}</Route>
      <Route path="/admin/configuracion/postmark">{() => <Suspense fallback={<AdminLoadingFallback />}><PostmarkSettings /></Suspense>}</Route>
      <Route path="/admin/configuracion/sitio">{() => <Suspense fallback={<AdminLoadingFallback />}><Settings /></Suspense>}</Route>
      <Route path="/admin/configuracion/sedes">{() => <Suspense fallback={<AdminLoadingFallback />}><SitesManager /></Suspense>}</Route>
      <Route path="/admin/configuracion/estado">{() => <Suspense fallback={<AdminLoadingFallback />}><ConfigStatus /></Suspense>}</Route>
      <Route path="/admin/configuracion/avanzado">{() => <Suspense fallback={<AdminLoadingFallback />}><AdvancedSettings /></Suspense>}</Route>
      <Route path="/admin/configuracion/email">{() => <Suspense fallback={<AdminLoadingFallback />}><EmailAccountsSettings /></Suspense>}</Route>
      <Route path="/admin/onboarding">{() => <Suspense fallback={<AdminLoadingFallback />}><OnboardingWizard /></Suspense>}</Route>
      <Route path="/admin/primeros-pasos">{() => <Suspense fallback={<AdminLoadingFallback />}><PrimerosPasos /></Suspense>}</Route>
      <Route path="/admin/numeracion">{() => <Suspense fallback={<AdminLoadingFallback />}><DocumentNumbersAdmin /></Suspense>}</Route>
      <Route path="/admin/suscripcion/exportar">{() => <Suspense fallback={<AdminLoadingFallback />}><DataExportPage /></Suspense>}</Route>
      <Route path="/admin/suscripcion/modulos">{() => <Suspense fallback={<AdminLoadingFallback />}><ModulesPage /></Suspense>}</Route>
      <Route path="/admin/suscripcion/consumo">{() => <Suspense fallback={<AdminLoadingFallback />}><UsagePage /></Suspense>}</Route>
      <Route path="/admin/suscripcion">{() => <Suspense fallback={<AdminLoadingFallback />}><SubscriptionPage /></Suspense>}</Route>
      <Route path="/admin/ampliar/:clave">{() => <Suspense fallback={<AdminLoadingFallback />}><ConnectDetailPage /></Suspense>}</Route>
      <Route path="/admin/ampliar">{() => <Suspense fallback={<AdminLoadingFallback />}><ConnectPage /></Suspense>}</Route>
      <Route path="/admin/soporte">{() => <Suspense fallback={<AdminLoadingFallback />}><SupportTicketsPage /></Suspense>}</Route>
      <Route path="/admin/soporte/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><SupportTicketsPage /></Suspense>}</Route>
      <Route path="/admin/ayuda">{() => <Suspense fallback={<AdminLoadingFallback />}><HelpCenter /></Suspense>}</Route>
      <Route path="/admin/ayuda/:id">{() => <Suspense fallback={<AdminLoadingFallback />}><HelpCenter /></Suspense>}</Route>

      {/* 404 */}
      <Route path="/404" component={NotFound} />
      {/* Multiempresa: páginas propias del tenant; en un solo tenant sigue siendo 404 */}
      <Route path="/:slug">{(p) => <SlugGate slug={p.slug} />}</Route>
      <Route component={NotFound} />
    </Switch>
    </AdminRouteGate>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <TenantThemeLoader />
        <TooltipProvider>
          <Toaster richColors position="top-right" />
          <ScrollToTop />
          <MaintenanceGate>
            <Router />
          </MaintenanceGate>
          <CookieBanner />
          <MetaPixelLoader />
          <GA4Loader />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
