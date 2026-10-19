// Shared by the pre-paint script in the root layout and the theme control.
// "system" is stored as the absence of a choice, so the root element carries
// no data-theme and the CSS follows the OS.

export const THEME_STORAGE_KEY = "theme";

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];
// Null until the browser has read the stored choice.
export type ThemeChoice = Theme | null;

export function isForcedTheme(value: string | null): value is "light" | "dark" {
  return value === "light" || value === "dark";
}

// Runs before first paint, so a reload never shows the wrong palette.
export const themeScript = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}})()`;
