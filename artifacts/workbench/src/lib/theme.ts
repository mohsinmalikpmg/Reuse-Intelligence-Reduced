import { useCallback, useSyncExternalStore } from "react";

/**
 * React binding for the shared FUSEBOX theme runtime (scripts/theme/theme-runtime.js), which the
 * host-theme Vite plugin inlines into <head> so the class is set before first paint.
 * Same contract everywhere: localStorage "fusebox.theme", html.dark + color-scheme, "fusebox-theme" event,
 * cross-tab sync via the storage event. If the runtime is absent (config without the wrapper) this module
 * applies the same contract itself so the toggle still works.
 */
export type Theme = "light" | "dark";
const KEY = "fusebox.theme";
const EVT = "fusebox-theme";

type Runtime = { get: () => Theme; set: (t: Theme) => void };
const runtime = (): Runtime | undefined => (window as unknown as { FuseboxTheme?: Runtime }).FuseboxTheme;

const valid = (v: unknown): Theme | null => (v === "dark" || v === "light" ? v : null);
function stored(): Theme | null {
  try { return valid(window.localStorage.getItem(KEY)); } catch { return null; }
}
const system = (): Theme => (window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light");
const read = (): Theme => (document.documentElement.classList.contains("dark") ? "dark" : "light");

function apply(t: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", t === "dark");
  root.setAttribute("data-theme", t);
  root.style.colorScheme = t;
  window.dispatchEvent(new CustomEvent(EVT, { detail: t }));
}

if (typeof window !== "undefined" && !runtime()) {
  apply(stored() ?? system());
  window.addEventListener("storage", (e) => {
    if (e.key === KEY || e.key === null) apply(valid(e.newValue) ?? system());
  });
}

export function setTheme(t: Theme) {
  const rt = runtime();
  if (rt) return rt.set(t);
  try { window.localStorage.setItem(KEY, t); } catch { /* storage denied: this page only */ }
  apply(t);
}

function subscribe(cb: () => void) {
  window.addEventListener(EVT, cb);
  return () => window.removeEventListener(EVT, cb);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, () => "light" as Theme);
  const toggle = useCallback(() => setTheme(read() === "dark" ? "light" : "dark"), []);
  return { theme, setTheme, toggle };
}
