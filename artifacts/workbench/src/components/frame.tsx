import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { ChevronDown, Compass, Layers, LogOut, Menu, Network, RotateCcw, Search, ShieldCheck, Zap, type LucideIcon } from "lucide-react";
import { useGetDemoState, useListPersonas, useResetDemo, type Role } from "@workspace/api-client-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePersona } from "@/lib/persona";
import { useMotion } from "@/lib/motion";
import { landingFor, useCurrentCase, useInvalidateAll, useMe } from "@/lib/case";
import { useUndoToast } from "@/components/bits";
import { cn } from "@/lib/utils";

export const ROLE_TABS: { role: Role; label: string; id: string }[] = [
  { role: "seeker", label: "Solution Seeker", id: "persona-seeker" },
  { role: "it", label: "IT Owner", id: "persona-it" },
];

const BRAND = `${import.meta.env.BASE_URL}brand/`;

/** FUSEBOX wordmark with the Power Cube mark. `light` = the version for dark surfaces. Vector artwork, never retyped. */
export function Logo({ light, className, plain }: { light?: boolean; className?: string; plain?: boolean }) {
  return (
    <img data-testid={plain ? undefined : "img-logo"} src={`${BRAND}${light ? "fusebox-logo-dark" : "fusebox-logo-light"}.svg`} alt="FUSEBOX" className={cn("h-7 w-auto select-none", className)} draggable={false} />
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

/** The three circuit stages of the kit. Every destination and every page belongs to exactly one. */
export const STAGES = {
  trace: { n: "01", label: "Trace" },
  connect: { n: "02", label: "Connect + Energize" },
  converge: { n: "03", label: "Converge" },
} as const;
export type Stage = keyof typeof STAGES;

type NavItem = { href: string; label: string; match: string; icon: LucideIcon; stage: Stage };

/** Breadcrumb for the top bar: `FUSEBOX / <stage> / <page>`. Pages that belong to a destination inherit its stage. */
function crumbsFor(location: string): { stage: Stage; page: string } {
  if (location.startsWith("/discover")) return { stage: "trace", page: "Discover" };
  if (location.startsWith("/library")) return { stage: "trace", page: "Library" };
  if (location.startsWith("/solutions/")) return { stage: "trace", page: "Solution" };
  if (location.startsWith("/search")) return { stage: "trace", page: "Search" };
  if (location.startsWith("/workbench")) return { stage: "connect", page: "Workbench" };
  if (location.startsWith("/test/")) return { stage: "connect", page: "Blind test" };
  if (location.startsWith("/cases/")) return { stage: "converge", page: "Decision view" };
  if (/^\/my-solutions\/.+\/improvements\//.test(location)) return { stage: "converge", page: "Shared improvement" };
  if (location.startsWith("/my-solutions")) return { stage: "converge", page: "My Solutions" };
  if (location.startsWith("/portfolio")) return { stage: "converge", page: "Portfolio" };
  return { stage: "trace", page: "Not found" };
}

/** One sidebar is rendered at a time (full or icon rail) so every control keeps a single test id. */
function useMediaQuery(query: string): boolean {
  const [on, setOn] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const h = () => setOn(mq.matches);
    h();
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, [query]);
  return on;
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
  const { motion, setMotion } = useMotion();
  const [q, setQ] = useState("");
  const [menu, setMenu] = useState(false);
  const desktop = useMediaQuery("(min-width: 768px)"); // sidebar (rail or full) + top-bar controls; below it the phone menu
  const wide = useMediaQuery("(min-width: 1024px)"); // full sidebar; between md and lg the icon rail

  const routeCase = location.match(/^\/workbench\/([^/?]+)/)?.[1];
  useEffect(() => {
    if (routeCase && routeCase !== caseId) setCaseId(routeCase);
  }, [routeCase, caseId, setCaseId]);
  useEffect(() => {
    if (!persona) setLocation("/");
  }, [persona, setLocation]);
  useEffect(() => setMenu(false), [location]);

  if (!persona) return null;
  const wbCase = caseId ?? demo.data?.demoCaseId;
  const NAV: NavItem[] = ([
    { href: "/discover", label: "Discover", match: "/discover", icon: Compass, stage: "trace" },
    { href: "/library", label: "Library", match: "/library", icon: Network, stage: "trace" },
    { href: wbCase ? `/workbench/${wbCase}` : "/library", label: "Workbench", match: "/workbench", icon: Zap, stage: "connect" },
    { href: "/my-solutions", label: "My Solutions", match: "/my-solutions", icon: Layers, stage: "converge" },
    { href: "/portfolio", label: "Portfolio", match: "/portfolio", icon: ShieldCheck, stage: "converge" },
  ] satisfies NavItem[]).filter((n) => persona.role === "it" || !["/portfolio", "/my-solutions"].includes(n.href));
  const isOn = (n: NavItem) => location.startsWith(n.match) || (n.match === "/library" && (location.startsWith("/solutions") || location.startsWith("/search")));
  const crumbs = crumbsFor(location);
  const roleLabel = ROLE_TABS.find((t) => t.role === persona.role)?.label ?? "";
  const initials = (me?.name ?? "?").split(" ").map((s) => s[0]).join("").slice(0, 2);

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

  const search = (cls?: string) => (
    <form role="search" onSubmit={(e) => { e.preventDefault(); if (q.trim()) setLocation(`/search?q=${encodeURIComponent(q.trim())}`); }} className={cn("relative min-w-0", cls)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <input
        data-testid="input-global-search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search problems, solutions, capabilities"
        className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[14px] text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary"
      />
    </form>
  );

  const roleSwitch = (
    <div role="radiogroup" aria-label="Role" className="flex shrink-0 rounded-lg bg-secondary p-0.5" data-testid="switch-role">
      {ROLE_TABS.map((t) => (
        <button
          key={t.role}
          role="radio"
          aria-checked={persona.role === t.role}
          data-testid={`button-role-${t.role}`}
          onClick={() => setPersona({ id: personas.data?.find((p) => p.role === t.role)?.id ?? t.id, role: t.role })}
          className={cn("min-h-8 rounded-md px-3 text-[13.5px] font-semibold transition-colors", persona.role === t.role ? "bg-primary text-white shadow-sm" : "text-primary/80 hover:text-primary")}
        >
          {t.label}
        </button>
      ))}
    </div>
  );

  /** Stage-grouped destinations. `rail` = icon-only (tablet). */
  const navList = (rail: boolean) => (
    <nav aria-label="Primary" className={cn("flex flex-col", rail ? "gap-3 px-2" : "gap-4 px-3")}>
      {(Object.keys(STAGES) as Stage[]).map((s) => (
        <div key={s}>
          <div className={cn("mb-1 flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/50", rail ? "justify-center" : "px-2")}>
            <span className="rounded border border-white/15 px-1 py-px text-[10px] text-white/70">{STAGES[s].n}</span>
            {!rail && <span className="truncate">{STAGES[s].label}</span>}
          </div>
          <ul className="flex flex-col gap-0.5">
            {NAV.filter((n) => n.stage === s).map((n) => {
              const on = isOn(n);
              const Icon = n.icon;
              const link = (
                <Link href={n.href} data-testid={`link-nav-${n.match.slice(1)}`} aria-current={on ? "page" : undefined} aria-label={rail ? n.label : undefined}
                  className={cn("relative flex min-h-11 items-center gap-3 rounded-xl text-[14.5px] font-medium transition-colors", rail ? "justify-center px-0" : "px-3",
                    on ? "bg-sidebar-accent text-white shadow-[inset_0_0_0_1px_hsl(var(--sidebar-border))]" : "text-white/70 hover:bg-white/5 hover:text-white")}>
                  {on && <span aria-hidden className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r bg-sienna" />}
                  <Icon className={cn("h-[18px] w-[18px] shrink-0", on ? "text-cyan" : "")} />
                  {!rail && <span className="truncate">{n.label}</span>}
                </Link>
              );
              return (
                <li key={n.label}>
                  {rail ? (
                    <Tooltip><TooltipTrigger asChild>{link}</TooltipTrigger><TooltipContent side="right">{n.label}</TooltipContent></Tooltip>
                  ) : link}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );

  const motionSwitch = (rail: boolean) => (
    <label className={cn("flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-white/80 hover:bg-white/5", rail && "justify-center px-0")} title={rail ? "Tactile motion" : undefined}>
      <Switch data-testid="switch-motion" checked={motion} onCheckedChange={setMotion} aria-label="Tactile motion"
        className="data-[state=checked]:bg-sienna data-[state=unchecked]:bg-white/25 focus-visible:ring-orange focus-visible:ring-offset-navy" />
      {!rail && <span className="min-w-0"><span className="block text-[13.5px] font-medium text-white">Tactile motion</span><span className="block text-[11.5px] leading-snug text-white/55">Visual feedback is optional; the facts stay.</span></span>}
    </label>
  );

  const demoCard = (rail: boolean) => (
    <div className={cn("rounded-xl border border-sidebar-border bg-sidebar-accent", rail ? "p-1.5" : "p-3")} data-testid="panel-demo-state">
      <div className={cn("flex items-center gap-2.5", rail && "justify-center")}>
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/15 text-[12px] font-semibold text-white" title={me?.name}>{initials}</span>
        {!rail && (
          <span className="min-w-0">
            <span className="block truncate text-[13.5px] font-semibold text-white">{me?.name ?? "Signed in"}</span>
            <span className="block truncate text-[11.5px] text-white/55">{roleLabel}{me?.team ? ` · ${me.team}` : ""}</span>
          </span>
        )}
      </div>
      <button data-testid="button-reset-demo" onClick={doReset} disabled={reset.isPending} aria-label="Reset demo"
        className={cn("mt-2 inline-flex min-h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-white/15 text-[13px] font-medium text-white/85 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50", rail ? "px-0" : "px-2.5")}>
        <RotateCcw className={cn("h-4 w-4", reset.isPending && "animate-spin")} /> {!rail && "Reset demo"}
      </button>
    </div>
  );

  const sidebarBody = (rail: boolean) => (
    <>
      <div className={cn("flex items-center", rail ? "justify-center px-2 pt-5" : "px-5 pt-5")}>
        <Link href={landingFor(persona.role)} data-testid="link-home" aria-label="FUSEBOX home" className="block">
          {rail ? <img data-testid="img-logo" src={`${BRAND}power-cube.svg`} alt="FUSEBOX" className="h-8 w-8" draggable={false} /> : <Logo light className="h-8" />}
        </Link>
      </div>
      {!rail && <div className="px-5 pt-2 font-mono text-[10.5px] uppercase tracking-[0.16em] text-cyan/80">AI solution convergence</div>}
      {!rail && <div className="eyebrow px-5 pb-2 pt-7 text-white/45">Explore the system</div>}
      {rail && <div className="h-6" />}
      {navList(rail)}
      <div className="flex-1" />
      <div className={cn("flex flex-col gap-2 pb-4", rail ? "px-2" : "px-3")}>
        {demoCard(rail)}
        {motionSwitch(rail)}
      </div>
    </>
  );

  return (
    <div className="min-h-[100dvh] md:grid md:grid-cols-[var(--shell-rail)_minmax(0,1fr)] lg:grid-cols-[var(--shell-side)_minmax(0,1fr)]">
      {/* Electric Ink sidebar: full on desktop, icon rail on tablet, hidden on phones (menu in the top bar instead) */}
      {desktop && <aside className="sticky top-0 flex h-[100dvh] flex-col overflow-y-auto bg-sidebar text-sidebar-foreground" data-testid={wide ? "sidebar" : "sidebar-rail"}>{sidebarBody(!wide)}</aside>}

      <div className="min-w-0">
        <header className="sticky top-0 z-40 h-[var(--shell-top)] border-b border-border bg-white/95 backdrop-blur-sm">
          <div className="flex h-full items-center gap-3 px-4 md:px-6">
            {/* Phone: menu + wordmark */}
            {!desktop && <button type="button" onClick={() => setMenu(true)} aria-label="Open menu" data-testid="button-menu" className="grid h-9 w-9 place-items-center rounded-lg text-primary hover:bg-secondary"><Menu className="h-5 w-5" /></button>}
            {!desktop && <Link href={landingFor(persona.role)} aria-label="FUSEBOX home"><Logo className="h-6" /></Link>}

            {/* Breadcrumb (needs the room; from lg up) */}
            {desktop && <ol className="hidden min-w-0 items-center gap-2 text-[13px] lg:flex" aria-label="Breadcrumb" data-testid="breadcrumb">
              <li className="font-mono text-[11.5px] tracking-[0.12em] text-muted-foreground">FUSEBOX</li>
              <li aria-hidden className="text-muted-foreground/60">/</li>
              <li className="whitespace-nowrap text-muted-foreground">{STAGES[crumbs.stage].label}</li>
              <li aria-hidden className="text-muted-foreground/60">/</li>
              <li className="truncate whitespace-nowrap font-semibold text-primary" aria-current="page">{crumbs.page}</li>
            </ol>}

            <div className="flex-1" />
            {/* Global search is always reachable: in the top bar from 768px up, in the phone menu below */}
            {desktop && search("w-[200px] lg:w-[240px] xl:w-[300px]")}
            {desktop && roleSwitch}
            <DropdownMenu>
              <DropdownMenuTrigger data-testid="button-persona-menu" className="flex min-h-9 items-center gap-2 rounded-lg px-1.5 text-[13px] text-primary hover:bg-secondary">
                <span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[12px] font-semibold text-white">{initials}</span>
                <span data-testid="text-persona-name" className="hidden max-w-[140px] truncate xl:block">{me?.name ?? "Signed in"}</span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60">
                {me && <div className="px-2 py-1.5 text-xs text-muted-foreground">{me.title} · {me.team}</div>}
                <DropdownMenuItem data-testid="menu-reset-demo" onClick={doReset} disabled={reset.isPending}><RotateCcw className="mr-2 h-4 w-4" /> Reset demo</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem data-testid="button-sign-out" onClick={() => { setPersona(null); setLocation("/"); }}><LogOut className="mr-2 h-4 w-4" /> Sign out</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* Endorsement zone: hairline, then the unaltered Cenovus mark */}
            <span aria-hidden className="h-6 w-px bg-border" />
            <CenovusEndorsement />
          </div>
        </header>
        <main>{children}</main>
      </div>

      {/* Phone menu: the same destinations, search, role switch and motion preference (only mounted below 768px) */}
      {!desktop && <Sheet open={menu} onOpenChange={setMenu}>
        <SheetContent side="left" className="w-[300px] overflow-y-auto border-r-0 bg-sidebar p-0 text-sidebar-foreground [&>button]:text-white" data-testid="sheet-menu">
          <SheetHeader className="px-5 pt-5 text-left">
            <SheetTitle className="sr-only">Menu</SheetTitle>
            <SheetDescription className="sr-only">Destinations, search and role</SheetDescription>
            <Logo light plain className="h-8" />
            <div className="pt-1 font-mono text-[10.5px] uppercase tracking-[0.16em] text-cyan/80">AI solution convergence</div>
          </SheetHeader>
          <div className="space-y-4 px-5 pt-5">
            {search()}
            {roleSwitch}
          </div>
          <div className="eyebrow px-5 pb-2 pt-6 text-white/45">Explore the system</div>
          {navList(false)}
          <div className="px-3 pb-6 pt-6">{motionSwitch(false)}</div>
        </SheetContent>
      </Sheet>}
    </div>
  );
}
