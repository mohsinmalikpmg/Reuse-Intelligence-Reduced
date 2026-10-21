import { useEffect } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Compass, ShieldCheck, Wrench } from "lucide-react";
import { useListPersonas, type Role } from "@workspace/api-client-react";
import { usePersona } from "@/lib/persona";
import { landingFor } from "@/lib/case";
import { CenovusEndorsement, Logo, ROLE_TABS } from "@/components/frame";
import { Skel } from "@/components/bits";

const LINE: Record<Role, { text: string; icon: typeof Compass }> = {
  seeker: { text: "Describe a problem. Find what already exists. Try it on real data.", icon: Compass },
  owner: { text: "Review proposed changes to your products with side-by-side output evidence.", icon: Wrench },
  it: { text: "See overlap across the portfolio and approve a consolidation direction.", icon: ShieldCheck },
};

export default function SignIn() {
  const { persona, setPersona } = usePersona();
  const [, setLocation] = useLocation();
  const personas = useListPersonas();
  const deep = new URLSearchParams(window.location.search).get("as");
  useEffect(() => {
    if (deep && persona) setLocation(landingFor(persona.role));
  }, [deep, persona, setLocation]);

  const go = (role: Role) => {
    const p = personas.data?.find((x) => x.role === role);
    setPersona({ id: p?.id ?? ROLE_TABS.find((t) => t.role === role)!.id, role });
    setLocation(landingFor(role));
  };

  return (
    <div className="min-h-[100dvh]">
      <div className="bg-sidebar">
        <header className="mx-auto flex h-16 max-w-[1100px] items-center justify-between px-5 md:px-8"><Logo light /><CenovusEndorsement /></header>
      </div>
      <div className="mx-auto max-w-[1100px] px-5 pb-16 pt-14 md:px-8 md:pt-20">
        <div className="eyebrow">Internal tool</div>
        <h1 className="mt-2 max-w-3xl text-[38px] font-bold leading-[1.08] md:text-[52px]">Find what exists. Improve what works. <span className="text-siennaink">Test the difference.</span></h1>
        <p className="mt-4 text-[17px] text-muted-foreground">Sign in as one of the demo accounts.</p>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {ROLE_TABS.map((t) => {
            const p = personas.data?.find((x) => x.role === t.role);
            const Icon = LINE[t.role].icon;
            return (
              <button key={t.role} onClick={() => go(t.role)} data-testid={`button-signin-${t.role}`}
                className="card-soft group flex min-h-[240px] flex-col p-6 text-left transition-[border-color,box-shadow] hover:border-primary/40 hover:shadow-md">
                <span className="grid h-10 w-10 place-items-center rounded-lg bg-secondary text-primary"><Icon className="h-5 w-5" /></span>
                <span className="mt-4 text-[26px] font-bold text-primary">{t.label}</span>
                <span className="mt-2 text-[15px] leading-snug text-muted-foreground">{LINE[t.role].text}</span>
                <span className="mt-auto flex items-end justify-between pt-6">
                  <span className="text-[14px]" data-testid={`text-persona-${t.role}`}>
                    {personas.isLoading ? <Skel className="h-4 w-36" /> : p ? <><span className="font-semibold">{p.name}</span><br /><span className="text-muted-foreground">{p.title}</span></> : null}
                  </span>
                  <span className="grid h-10 w-10 place-items-center rounded-full bg-primary text-white transition-transform group-hover:translate-x-0.5"><ArrowRight className="h-5 w-5" /></span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
