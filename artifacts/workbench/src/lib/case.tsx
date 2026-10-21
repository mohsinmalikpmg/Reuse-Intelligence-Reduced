import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetDemoState, useListPersonas, type Persona } from "@workspace/api-client-react";
import { usePersona } from "@/lib/persona";

const KEY = "reuse-workbench.case";
type Ctx = { caseId: string | null; setCaseId: (id: string) => void };
const CaseContext = createContext<Ctx>({ caseId: null, setCaseId: () => {} });

export function CaseProvider({ children }: { children: ReactNode }) {
  const [caseId, setState] = useState<string | null>(() => localStorage.getItem(KEY));
  const demo = useGetDemoState();
  const setCaseId = useCallback((id: string) => {
    localStorage.setItem(KEY, id);
    setState(id);
  }, []);
  useEffect(() => {
    if (!caseId && demo.data?.demoCaseId) setCaseId(demo.data.demoCaseId);
  }, [caseId, demo.data?.demoCaseId, setCaseId]);
  return <CaseContext.Provider value={{ caseId, setCaseId }}>{children}</CaseContext.Provider>;
}

export function useCurrentCase() {
  return useContext(CaseContext);
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return useCallback(() => qc.invalidateQueries(), [qc]);
}

/** Refresh every query that belongs to one case. */
export function useInvalidateCase() {
  const qc = useQueryClient();
  return useCallback((caseId: string) => qc.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).includes(`/cases/${caseId}`) || String(q.queryKey[0]).includes("/my-solutions") || String(q.queryKey[0]).includes("/portfolio") }), [qc]);
}

export function useMe(): Persona | undefined {
  const { persona } = usePersona();
  const personas = useListPersonas();
  return personas.data?.find((p) => p.id === persona?.id) ?? personas.data?.find((p) => p.role === persona?.role);
}

export function errMsg(e: unknown): string {
  if (e && typeof e === "object") {
    const d = (e as { data?: unknown }).data;
    if (d && typeof d === "object" && typeof (d as { error?: unknown }).error === "string") return (d as { error: string }).error;
    if (e instanceof Error) return e.message;
  }
  return "Something did not go through. Nothing was changed.";
}

export function landingFor(role: "seeker" | "owner" | "it") {
  return role === "seeker" ? "/discover" : role === "owner" ? "/my-solutions" : "/portfolio";
}
