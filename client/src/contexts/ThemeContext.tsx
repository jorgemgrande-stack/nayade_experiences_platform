import React, { createContext, useContext, useEffect, useState } from "react";

type Theme = "light" | "dark";

interface ThemeContextType {
  /** Tema del panel de administración */
  adminTheme: Theme;
  toggleAdminTheme: () => void;
  /** Tema de la web pública */
  publicTheme: Theme;
  togglePublicTheme: () => void;
  /** Alias para compatibilidad con código anterior (= adminTheme) */
  theme: Theme;
  toggleTheme: () => void;
  switchable: boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [adminTheme, setAdminTheme] = useState<Theme>(() => {
    return (localStorage.getItem("nayade-admin-theme") as Theme) || "dark";
  });

  const [publicTheme, setPublicTheme] = useState<Theme>(() => {
    return (localStorage.getItem("nayade-public-theme") as Theme) || "light";
  });

  // El tema admin controla html.dark — los portales (Dialog, Popover…) heredan el modo oscuro
  useEffect(() => {
    const root = document.documentElement;
    if (adminTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("nayade-admin-theme", adminTheme);
  }, [adminTheme]);

  // El tema público se guarda; se aplica en PublicLayout
  useEffect(() => {
    localStorage.setItem("nayade-public-theme", publicTheme);
  }, [publicTheme]);

  const toggleAdminTheme = () =>
    setAdminTheme(prev => (prev === "light" ? "dark" : "light"));

  const togglePublicTheme = () =>
    setPublicTheme(prev => (prev === "light" ? "dark" : "light"));

  return (
    <ThemeContext.Provider
      value={{
        adminTheme,
        toggleAdminTheme,
        publicTheme,
        togglePublicTheme,
        theme: adminTheme,
        toggleTheme: toggleAdminTheme,
        switchable: true,
      }}
    >
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return context;
}
