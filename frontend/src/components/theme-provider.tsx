"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

type Theme = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";
type ThemeSelection = Theme | ((current: Theme) => Theme);

interface ThemeContextValue {
  theme: Theme;
  resolvedTheme: ResolvedTheme | undefined;
  setTheme: (theme: ThemeSelection) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  resolvedTheme: undefined,
  setTheme: () => undefined,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => readStoredTheme() ?? "system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>();
  const themeRef = useRef<Theme>(theme);

  const applyTheme = useCallback((nextTheme: Theme) => {
    const nextResolvedTheme = resolveTheme(nextTheme);
    const root = document.documentElement;

    disableTransitions();
    root.setAttribute("data-theme", nextResolvedTheme);
    root.style.colorScheme = nextResolvedTheme;
    setResolvedTheme(nextResolvedTheme);
  }, []);

  useEffect(() => {
    applyTheme(themeRef.current);

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const onSystemThemeChange = () => {
      if (themeRef.current === "system") applyTheme("system");
    };
    const onStorageChange = (event: StorageEvent) => {
      if (event.key !== "theme") return;
      const nextTheme = normalizeTheme(event.newValue) ?? "system";
      themeRef.current = nextTheme;
      setThemeState(nextTheme);
      applyTheme(nextTheme);
    };

    mediaQuery.addEventListener("change", onSystemThemeChange);
    window.addEventListener("storage", onStorageChange);
    return () => {
      mediaQuery.removeEventListener("change", onSystemThemeChange);
      window.removeEventListener("storage", onStorageChange);
    };
  }, [applyTheme]);

  const setTheme = useCallback((selection: ThemeSelection) => {
    const nextTheme = typeof selection === "function" ? selection(themeRef.current) : selection;
    themeRef.current = nextTheme;
    setThemeState(nextTheme);
    try {
      window.localStorage.setItem("theme", nextTheme);
    } catch { /* Theme still applies when storage is unavailable. */ }
    applyTheme(nextTheme);
  }, [applyTheme]);

  const value = useMemo(() => ({ theme, resolvedTheme, setTheme }), [resolvedTheme, setTheme, theme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

function readStoredTheme() {
  try {
    return normalizeTheme(window.localStorage.getItem("theme"));
  } catch {
    return undefined;
  }
}

function normalizeTheme(value: string | null): Theme | undefined {
  return value === "light" || value === "dark" || value === "system" ? value : undefined;
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "dark") return "dark";
  if (theme === "light") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function disableTransitions() {
  const style = document.createElement("style");
  style.appendChild(document.createTextNode("*,*::before,*::after{transition:none!important}"));
  document.head.appendChild(style);
  window.getComputedStyle(document.body);
  window.setTimeout(() => style.remove(), 1);
}
