import PublicNav from "./PublicNav";
import PublicFooter from "./PublicFooter";

interface PublicLayoutProps {
  children: React.ReactNode;
  fullWidthHero?: boolean;
}

export default function PublicLayout({ children, fullWidthHero = false }: PublicLayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <PublicNav />
      <main className={`flex-1 ${fullWidthHero ? "" : "pt-20 lg:pt-[112px]"}`}>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
