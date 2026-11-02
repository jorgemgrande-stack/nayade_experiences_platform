/** Iconos de los módulos de Elephant Studio (el nombre lo declara cada módulo en shared/studio/modules.ts). */
import {
  AlignLeft, Columns2, Film, Heading, HelpCircle, Image as ImageIcon, Images, LayoutGrid, LayoutTemplate, Mail, Megaphone, Minus,
  MousePointerClick, ShoppingBag, MessageSquareQuote, Square, type LucideIcon,
} from "lucide-react";

export const MODULE_ICONS: Record<string, LucideIcon> = {
  heading: Heading, text: AlignLeft, image: ImageIcon, button: MousePointerClick, video: Film, separator: Minus, hero: LayoutTemplate,
  columns: Columns2, cta: Megaphone, form: Mail, gallery: Images, features: LayoutGrid, testimonials: MessageSquareQuote, faq: HelpCircle,
  products: ShoppingBag,
};

export const moduleIcon = (name: string | undefined): LucideIcon => (name && MODULE_ICONS[name]) || Square;
