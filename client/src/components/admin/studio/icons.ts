/** Iconos de los módulos de Elephant Studio (el nombre lo declara cada módulo en shared/studio/modules.ts). */
import {
  AlignLeft, Columns2, Film, Heading, HelpCircle, Image as ImageIcon, Images, LayoutGrid, LayoutTemplate, Mail, Megaphone, Minus,
  MousePointerClick, ShoppingBag, MessageSquareQuote, Square, GalleryHorizontalEnd, PanelsTopLeft, LayoutDashboard, ClipboardList, BadgeEuro, BarChart3, Award, Columns3, Newspaper, type LucideIcon,
} from "lucide-react";

export const MODULE_ICONS: Record<string, LucideIcon> = {
  heading: Heading, text: AlignLeft, image: ImageIcon, button: MousePointerClick, video: Film, separator: Minus, hero: LayoutTemplate,
  columns: Columns2, cta: Megaphone, form: Mail, gallery: Images, features: LayoutGrid, testimonials: MessageSquareQuote, faq: HelpCircle,
  products: ShoppingBag, slideshow: PanelsTopLeft, carousel: GalleryHorizontalEnd, cards: LayoutDashboard, "form-builder": ClipboardList, pricing: BadgeEuro, stats: BarChart3, logos: Award, section: Columns3, blog: Newspaper,
};

export const moduleIcon = (name: string | undefined): LucideIcon => (name && MODULE_ICONS[name]) || Square;
