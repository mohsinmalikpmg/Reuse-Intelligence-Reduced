import { useEffect, type ReactNode } from "react";

/** Workflow animation accessibility follows the device, without an app preference. */
export function MotionProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    try { localStorage.removeItem("reuse-workbench.motion"); } catch { /* Storage may be unavailable. */ }
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const apply = () => { document.documentElement.dataset.motion = mq.matches ? "off" : "on"; };
    apply();
    mq.addEventListener("change", apply);
    return () => {
      mq.removeEventListener("change", apply);
      delete document.documentElement.dataset.motion;
    };
  }, []);
  return children;
}
