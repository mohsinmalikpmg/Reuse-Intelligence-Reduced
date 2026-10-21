import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * Tactile motion preference. Circuit feedback (seat, weld, current, converge) is optional: it defaults to on, follows the
 * OS reduced-motion setting when nothing has been chosen, and is remembered per browser. The choice is written to
 * `<html data-motion="on|off">`, which the stylesheet reads; the information every effect confirms stays visible either way.
 */
const KEY = "reuse-workbench.motion";
type Ctx = { motion: boolean; setMotion: (on: boolean) => void; explicit: boolean };
const MotionContext = createContext<Ctx>({ motion: true, setMotion: () => {}, explicit: false });

function osReduces(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function stored(): boolean | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === "on" ? true : v === "off" ? false : null;
  } catch {
    return null;
  }
}

export function MotionProvider({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<boolean | null>(stored);
  const [reduce, setReduce] = useState(osReduces);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduce(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  const motion = choice ?? !reduce;
  useEffect(() => {
    document.documentElement.dataset.motion = motion ? "on" : "off";
  }, [motion]);
  const setMotion = useCallback((on: boolean) => {
    try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private mode: keep it for this session only */ }
    setChoice(on);
  }, []);
  const value = useMemo(() => ({ motion, setMotion, explicit: choice !== null }), [motion, setMotion, choice]);
  return <MotionContext.Provider value={value}>{children}</MotionContext.Provider>;
}

export function useMotion() {
  return useContext(MotionContext);
}
