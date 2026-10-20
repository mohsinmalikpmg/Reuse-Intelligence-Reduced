import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronDown, LogOut, RotateCcw } from "lucide-react";
import { useHealthCheck, useListPersonas, useResetDemo, type Role } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { usePersona } from "@/lib/persona";
import { initials, roleLabel } from "@/lib/labels";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const NAV: Record<Role, { label: string; href: string }[]> = {
  seeker: [
    { label: "Discover", href: "/discover" },
    { label: "Saved cases", href: "/cases" },
    { label: "Library", href: "/library" },
  ],
  owner: [
    { label: "My solutions", href: "/home" },
    { label: "Change requests", href: "/cases" },
    { label: "Experiments", href: "/experiments" },
  ],
  it: [
    { label: "Portfolio", href: "/portfolio" },
    { label: "Consolidation cases", href: "/cases" },
    { label: "Decision queue", href: "/portfolio/queue" },
    { label: "Library", href: "/library" },
  ],
};

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="relative grid h-6 w-6 place-items-center">
        <span className="absolute left-0 top-0 h-3.5 w-3.5 rounded-[2px] border-2 border-current opacity-50" />
        <span className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-[2px] bg-primary" />
      </span>
      <span className="font-display text-[15px] font-bold tracking-tight">Reuse Workbench</span>
    </span>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const { persona, setPersona } = usePersona();
  const [location, setLocation] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const personas = useListPersonas();
  const health = useHealthCheck();
  const reset = useResetDemo();

  useEffect(() => {
    if (!persona) setLocation("/");
  }, [persona, setLocation]);

  if (!persona) return null;
  const me = personas.data?.find((p) => p.id === persona.id);
  const nav = NAV[persona.role];
  const healthy = health.data?.status === "ok";

  const doReset = () =>
    reset.mutate(undefined, {
      onSuccess: () => {
        qc.invalidateQueries();
        setLocation("/home");
        toast({ title: "Demo reset", description: "Seed data restored. Every case is back to its starting point." });
      },
    });

  return (
    <div className="min-h-[100dvh]">
      <header className="sticky top-0 z-40 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 md:px-6">
          <Link href="/home" data-testid="link-home"><Logo /></Link>
          <span className="hidden h-5 w-px bg-sidebar-border md:block" />
          <nav className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {nav.map((n) => {
              const active = location === n.href || (n.href !== "/home" && location.startsWith(n.href + "/") && !(n.href === "/portfolio" && location.startsWith("/portfolio/queue")));
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  data-testid={`link-nav-${n.label.toLowerCase().replace(/\s/g, "-")}`}
                  className={cn(
                    "relative whitespace-nowrap rounded px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    active ? "text-sidebar-foreground" : "text-sidebar-foreground/60 hover:text-sidebar-foreground",
                  )}
                >
                  {n.label}
                  {active && <span className="absolute inset-x-2.5 -bottom-[11px] h-[2px] bg-primary" />}
                </Link>
              );
            })}
          </nav>
          <span title={healthy ? "Platform online" : "Checking platform"} className="hidden items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/50 lg:flex">
            <span className={cn("h-1.5 w-1.5 rounded-full", healthy ? "bg-emerald-400" : "bg-sidebar-foreground/30")} />
            {healthy ? "Live" : "..."}
          </span>
          <button onClick={doReset} disabled={reset.isPending} data-testid="button-reset-demo" className="hidden items-center gap-1.5 rounded border border-sidebar-border px-2 py-1 text-xs text-sidebar-foreground/70 hover:text-sidebar-foreground sm:inline-flex">
            <RotateCcw className={cn("h-3.5 w-3.5", reset.isPending && "animate-spin")} /> Reset demo
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger data-testid="button-persona-switcher" className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 hover:bg-sidebar-accent">
              <span className="grid h-7 w-7 place-items-center rounded bg-primary font-mono text-[11px] font-semibold text-primary-foreground">
                {me ? initials(me.name) : "--"}
              </span>
              <span className="hidden text-left leading-tight md:block">
                <span className="block text-[12.5px] font-semibold">{me?.name ?? "Loading"}</span>
                <span className="block font-mono text-[10px] uppercase tracking-wider text-sidebar-foreground/55">{roleLabel[persona.role]}</span>
              </span>
              <ChevronDown className="h-3.5 w-3.5 opacity-60" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-72">
              <DropdownMenuLabel className="eyebrow">Switch role</DropdownMenuLabel>
              {personas.data?.map((p) => (
                <DropdownMenuItem
                  key={p.id}
                  data-testid={`menu-persona-${p.role}`}
                  onClick={() => {
                    setPersona({ id: p.id, role: p.role });
                    setLocation("/home");
                  }}
                  className="flex items-start gap-2.5 py-2"
                >
                  <span className={cn("mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold", p.id === persona.id ? "bg-primary text-primary-foreground" : "bg-muted")}>
                    {initials(p.name)}
                  </span>
                  <span className="leading-tight">
                    <span className="block text-sm font-medium">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{roleLabel[p.role]} · {p.team}</span>
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={doReset} className="sm:hidden"><RotateCcw className="mr-2 h-4 w-4" /> Reset demo</DropdownMenuItem>
              <DropdownMenuItem data-testid="button-sign-out" onClick={() => { setPersona(null); setLocation("/"); }}>
                <LogOut className="mr-2 h-4 w-4" /> Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>
      <main className="mx-auto max-w-[1400px] px-4 py-6 md:px-6 md:py-8">{children}</main>
    </div>
  );
}
