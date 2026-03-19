import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";

interface PublicLayoutProps {
  children: React.ReactNode;
  fullWidthHero?: boolean;
  /** When true, removes the light bg-background so the page can set its own dark background */
  darkContent?: boolean;
}

export default function PublicLayout({ children, fullWidthHero = false, darkContent = false }: PublicLayoutProps) {
  return (
    <div className={`min-h-screen flex flex-col ${darkContent ? "bg-slate-900" : "bg-background"}`}>
      <PublicNav />
      <main className={`flex-1 ${fullWidthHero ? "" : "pt-20 lg:pt-[112px]"}`}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
