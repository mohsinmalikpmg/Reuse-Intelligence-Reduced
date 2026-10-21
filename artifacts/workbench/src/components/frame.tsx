import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, LogOut, RotateCcw, Search } from "lucide-react";
import { useGetDemoState, useListPersonas, useResetDemo, type Role } from "@workspace/api-client-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { usePersona } from "@/lib/persona";
import { landingFor, useCurrentCase, useInvalidateAll, useMe } from "@/lib/case";
import { useUndoToast } from "@/components/bits";
import { cn } from "@/lib/utils";

export const ROLE_TABS: { role: Role; label: string; id: string }[] = [
  { role: "seeker", label: "Find", id: "persona-seeker" },
  { role: "owner", label: "Own", id: "persona-owner" },
  { role: "it", label: "Govern", id: "persona-it" },
];

const BRAND = `${import.meta.env.BASE_URL}brand/`;

/** FUSEBOX wordmark with the Power Cube mark. `light` = the version for dark surfaces. Vector artwork, never retyped. */
export function Logo({ light, className }: { light?: boolean; className?: string }) {
  return (
    <img data-testid="img-logo" src={`${BRAND}${light ? "fusebox-logo-dark" : "fusebox-logo-light"}.svg`} alt="FUSEBOX" className={cn("h-7 w-auto select-none", className)} draggable={false} />
  );
}

/** Cenovus Energy endorsement: the official mark, unaltered, on its own white field with clear space. */
export function CenovusEndorsement({ className }: { className?: string }) {
  return (
    <span data-testid="img-cenovus" className={cn("inline-flex shrink-0 items-center rounded-md bg-white px-2.5 py-1.5", className)} title="A Cenovus Energy product">
      <img src={`${BRAND}cenovus-energy-logo.png`} alt="Cenovus Energy" className="h-[18px] w-auto select-none" draggable={false} />
    </span>
  );
}

export function Frame({ children }: { children: ReactNode }) {
  const { persona, setPersona } = usePersona();
  const [location, setLocation] = useLocation();
  const { caseId, setCaseId } = useCurrentCase();
  const personas = useListPersonas();
  const demo = useGetDemoState();
  const reset = useResetDemo();
  const invalidate = useInvalidateAll();
  const say = useUndoToast();
  const me = useMe();
  const [q, setQ] = useState("");

  const routeCase = location.match(/^\/workbench\/([^/?]+)/)?.[1];
  useEffect(() => {
    if (routeCase && routeCase !== caseId) setCaseId(routeCase);
  }, [routeCase, caseId, setCaseId]);
  useEffect(() => {
    if (!persona) setLocation("/");
  }, [persona, setLocation]);

  if (!persona) return null;
  const wbCase = caseId ?? demo.data?.demoCaseId;
  const NAV = [
    { href: "/discover", label: "Discover", match: "/discover" },
    { href: "/library", label: "Library", match: "/library" },
    { href: wbCase ? `/workbench/${wbCase}` : "/library", label: "Workbench", match: "/workbench" },
    { href: "/my-solutions", label: "My Solutions", match: "/my-solutions" },
    { href: "/portfolio", label: "Portfolio", match: "/portfolio" },
  ];

  const doReset = () =>
    reset.mutate(undefined, {
      onSuccess: (d) => {
        const id = d.demoCaseId ?? demo.data?.demoCaseId;
        if (id) setCaseId(id);
        invalidate();
        say("Demo reset. Everything is back to the start.");
      },
      onError: () => say("Reset did not go through. Try again."),
    });

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-40 bg-sidebar text-sidebar-foreground shadow-sm">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 md:px-6">
          <Link href={landingFor(persona.role)} data-testid="link-home" className="shrink-0" aria-label="FUSEBOX home"><Logo light /></Link>
          <form
            role="search"
            onSubmit={(e) => { e.preventDefault(); if (q.trim()) setLocation(`/search?q=${encodeURIComponent(q.trim())}`); }}
            className="relative ml-2 hidden min-w-0 max-w-[360px] flex-1 md:block"
          >
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/60" />
            <input
              data-testid="input-global-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search problems, solutions, capabilities"
              className="h-9 w-full rounded-lg border border-white/15 bg-white/10 pl-9 pr-3 text-[14px] text-white placeholder:text-white/60 outline-none transition-colors focus:border-white/40 focus:bg-white/15"
            />
          </form>
          <div className="flex-1" />
          <div role="radiogroup" aria-label="Role" className="flex rounded-lg bg-sidebar-accent p-0.5" data-testid="switch-role">
            {ROLE_TABS.map((t) => (
              <button
                key={t.role}
                role="radio"
                aria-checked={persona.role === t.role}
                data-testid={`button-role-${t.role}`}
                onClick={() => setPersona({ id: personas.data?.find((p) => p.role === t.role)?.id ?? t.id, role: t.role })}
                className={cn("min-h-8 rounded-md px-3 text-[13.5px] font-semibold transition-colors", persona.role === t.role ? "bg-white text-primary" : "text-white/70 hover:text-white")}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button data-testid="button-reset-demo" onClick={doReset} disabled={reset.isPending} className="hidden min-h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-white/75 hover:bg-white/10 hover:text-white disabled:opacity-50 lg:inline-flex">
            <RotateCcw className={cn("h-4 w-4", reset.isPending && "animate-spin")} /> Reset demo
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger data-testid="button-persona-menu" className="flex min-h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-white/80 hover:bg-white/10 hover:text-white">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white/15 text-[12px] font-semibold">{(me?.name ?? "?").split(" ").map((s) => s[0]).join("").slice(0, 2)}</span>
              <span data-testid="text-persona-name" className="hidden max-w-[140px] truncate xl:block">{me?.name ?? "Signed in"}</span>
              <ChevronDown className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {me && <div className="px-2 py-1.5 text-xs text-muted-foreground">{me.title} · {me.team}</div>}
              <DropdownMenuItem data-testid="menu-reset-demo" onClick={doReset} disabled={reset.isPending}><RotateCcw className="mr-2 h-4 w-4" /> Reset demo</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem data-testid="button-sign-out" onClick={() => { setPersona(null); setLocation("/"); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <CenovusEndorsement className="ml-1 hidden md:inline-flex" />
        </div>
        <nav aria-label="Primary" className="border-t border-white/10">
          <ul className="mx-auto flex max-w-[1400px] gap-1 overflow-x-auto px-3 md:px-5">
            {NAV.map((n) => {
              const on = location.startsWith(n.match) || (n.match === "/library" && location.startsWith("/solutions")) || (n.match === "/library" && location.startsWith("/search"));
              return (
                <li key={n.label}>
                  <Link href={n.href} data-testid={`link-nav-${n.match.slice(1)}`} aria-current={on ? "page" : undefined}
                    className={cn("relative flex min-h-11 items-center whitespace-nowrap px-3 text-[14.5px] font-medium transition-colors", on ? "text-white" : "text-white/65 hover:text-white")}>
                    {n.label}
                    {on && <span className="absolute inset-x-3 bottom-0 h-[3px] rounded-t bg-sienna" />}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </header>
      <main>{children}</main>
    </div>
  );
}
