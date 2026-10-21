import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import type { Role } from "@workspace/api-client-react";

type Stored = { id: string; role: Role } | null;
type Ctx = { persona: Stored; setPersona: (p: Stored) => void };

const KEY = "reuse-workbench.persona";
const PersonaContext = createContext<Ctx>({ persona: null, setPersona: () => {} });

const DEMO_IDS: Record<Role, string> = { seeker: "persona-seeker", owner: "persona-owner", it: "persona-it" };
function normalize(p: Stored): Stored {
  if (!p) return null;
  return p.role === "owner" || p.role === "it"
    ? { id: "persona-it", role: "it" }
    : p.role === "seeker" ? { id: DEMO_IDS.seeker, role: "seeker" } : null;
}

/** Demo deep links: `?as=seeker|owner|it` signs in as that persona on load. */
function fromQuery(): Stored {
  const as = new URLSearchParams(window.location.search).get("as");
  if (as === "seeker" || as === "owner" || as === "it") {
    const p = normalize({ id: DEMO_IDS[as], role: as });
    localStorage.setItem(KEY, JSON.stringify(p));
    return p;
  }
  return null;
}

function read(): Stored {
  try {
    const fromLink = fromQuery();
    if (fromLink) return fromLink;
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return normalize(v);
  } catch {
    return null;
  }
}

export function PersonaProvider({ children }: { children: ReactNode }) {
  const [persona, setState] = useState<Stored>(read);
  const setPersona = useCallback((p: Stored) => {
    p = normalize(p);
    if (p) localStorage.setItem(KEY, JSON.stringify(p));
    else localStorage.removeItem(KEY);
    setState(p);
  }, []);
  return <PersonaContext.Provider value={{ persona, setPersona }}>{children}</PersonaContext.Provider>;
}

export function usePersona() {
  return useContext(PersonaContext);
}

export function useRole(): Role {
  return useContext(PersonaContext).persona?.role ?? "seeker";
}
