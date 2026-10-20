import { useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowRight } from "lucide-react";
import { useListPersonas } from "@workspace/api-client-react";
import { usePersona } from "@/lib/persona";
import { initials, roleLabel } from "@/lib/labels";
import { Logo } from "@/components/shell";
import { ErrorState, Rise, Skel } from "@/components/kit";

const ROLE_LINE = {
  seeker: "Describe a pain point. Get the proven product to start from.",
  owner: "Review capability changes before your users ever see them.",
  it: "See duplication, risk and ownership across the whole portfolio.",
} as const;

export default function Login() {
  const { persona, setPersona } = usePersona();
  const [, setLocation] = useLocation();
  const personas = useListPersonas();

  useEffect(() => {
    if (persona) setLocation("/home");
  }, [persona, setLocation]);

  return (
    <div className="grid min-h-[100dvh] lg:grid-cols-[1.1fr_1fr]">
      <div className="relative flex flex-col justify-between overflow-hidden bg-sidebar p-8 text-sidebar-foreground md:p-12">
        <div className="absolute -right-24 -top-24 h-96 w-96 rounded-full border-[40px] border-primary/15" />
        <div className="absolute -bottom-40 -left-10 h-[28rem] w-[28rem] rotate-12 border-[1px] border-sidebar-border" />
        <Logo />
        <div className="relative py-16">
          <div className="eyebrow mb-5 !text-primary">From duplicated prototypes to one proven product</div>
          <h1 className="font-display text-5xl font-extrabold leading-[0.95] md:text-7xl">
            Describe the problem.
            <br />
            <span className="text-sidebar-foreground/45">Reuse the best.</span>
            <br />
            <span className="text-primary">Prove the change.</span>
          </h1>
        </div>
        <div className="relative grid grid-cols-3 gap-4 border-t border-sidebar-border pt-5 font-mono text-[11px] uppercase tracking-wider text-sidebar-foreground/55">
          <span>01 Discover</span>
          <span>02 Simulate</span>
          <span>03 Govern</span>
        </div>
      </div>
      <div className="flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md">
          <div className="eyebrow mb-2">Choose who you are today</div>
          <h2 className="mb-6 text-2xl font-bold">Sign in as a persona</h2>
          {personas.isError && <ErrorState onRetry={() => personas.refetch()} />}
          <div className="space-y-3">
            {personas.isLoading && [0, 1, 2].map((i) => <Skel key={i} className="h-24" />)}
            {personas.data?.map((p, i) => (
              <Rise key={p.id} i={i}>
                <button
                  data-testid={`card-persona-${p.role}`}
                  onClick={() => {
                    setPersona({ id: p.id, role: p.role });
                    setLocation("/home");
                  }}
                  className="group flex w-full items-start gap-4 rounded-lg border-2 bg-card p-4 text-left transition-all hover:-translate-y-0.5 hover:border-foreground hover:shadow-[4px_4px_0_hsl(var(--primary))]"
                >
                  <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-foreground font-mono text-sm font-semibold text-background group-hover:bg-primary">
                    {initials(p.name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="eyebrow !text-primary">{roleLabel[p.role]}</span>
                    <span className="block font-display text-lg font-semibold leading-tight">{p.name}</span>
                    <span className="block text-xs text-muted-foreground">{p.title} · {p.team}</span>
                    <span className="mt-2 block text-sm">{p.headline || ROLE_LINE[p.role]}</span>
                  </span>
                  <ArrowRight className="mt-1 h-4 w-4 opacity-30 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                </button>
              </Rise>
            ))}
          </div>
          <p className="mt-6 text-xs text-muted-foreground">No passwords. Switch roles any time from the header.</p>
        </div>
      </div>
    </div>
  );
}
