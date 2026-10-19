"use client";

import { useSyncExternalStore } from "react";
import {
  isForcedTheme,
  THEME_STORAGE_KEY,
  THEMES,
  type Theme,
  type ThemeChoice,
} from "@/lib/theme";

const CHANGE_EVENT = "themechange";

// The root element's attribute is the source of truth; the pre-paint script
// set it from storage before React ran.
function readTheme(): Theme {
  const value = document.documentElement.getAttribute("data-theme");
  return isForcedTheme(value) ? value : "system";
}

function subscribe(onChange: () => void) {
  // Another tab changing the theme updates this one too.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY) return;
    applyTheme(isForcedTheme(event.newValue) ? event.newValue : "system", false);
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

function applyTheme(theme: Theme, persist: boolean) {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  if (persist) {
    try {
      if (theme === "system") localStorage.removeItem(THEME_STORAGE_KEY);
      else localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      // Storage blocked: the choice still applies, it just won't survive a reload.
    }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

const LABELS: Record<Theme, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

export function ThemeControl() {
  // The server can't know the stored choice, so nothing is pressed until the
  // client reads it. Avoids a hydration mismatch without guessing.
  const current = useSyncExternalStore<ThemeChoice>(
    subscribe,
    readTheme,
    () => null,
  );

  return (
    <div
      role="group"
      aria-label="Theme"
      className="flex h-6 items-stretch rounded border border-border text-[11px]"
    >
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          aria-pressed={current === theme}
          onClick={() => applyTheme(theme, true)}
          className="px-2 text-muted first:rounded-l-[3px] last:rounded-r-[3px] hover:text-text aria-pressed:bg-raised aria-pressed:text-text focus-visible:outline-2 focus-visible:outline-accent"
        >
          {LABELS[theme]}
        </button>
      ))}
    </div>
  );
}
