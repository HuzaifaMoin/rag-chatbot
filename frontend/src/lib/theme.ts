// Light/dark choice: "system" follows the computer, "light"/"dark" force it.
// Saved in localStorage; applied as data-theme on <html> (globals.css reads it).

export type ThemeChoice = "system" | "light" | "dark";

const KEY = "rag_theme";

export function readTheme(): ThemeChoice {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system"; // storage blocked (private mode etc.)
  }
}

export function applyTheme(choice: ThemeChoice): void {
  if (choice === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", choice);
  try {
    if (choice === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, choice);
  } catch {
    // storage blocked: the choice still applies until the page reloads
  }
}

// Runs in <head> before the page paints, so a forced theme never flashes the wrong colours.
export const THEME_SCRIPT = `try{var t=localStorage.getItem("${KEY}");if(t==="light"||t==="dark")document.documentElement.setAttribute("data-theme",t)}catch(e){}`;
