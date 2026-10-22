import { useEffect } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { ArrowRight, Cable } from "lucide-react";
import { cn } from "@/lib/utils";

/** Finance settings live inside each saved combination. This entry opens the Library finance launcher. */
export const financeLibraryHref = (extra?: URLSearchParams) => {
  const p = new URLSearchParams(extra);
  p.delete("combine");
  p.set("recipe", "finance");
  return `/library?${p.toString()}#combine`;
};

export function WiringEntry({ className, testid = "link-finance-wiring" }: { className?: string; testid?: string }) {
  return (
    <Link href={financeLibraryHref()} data-testid={testid}
      className={cn("group inline-flex min-h-10 items-center gap-2.5 rounded-xl border border-[#173D4A] bg-[#081F29] px-3.5 text-[13.5px] font-semibold text-[#D9EFF2] transition-colors hover:border-[#CE7642]", className)}>
      <Cable className="h-4 w-4 text-cyan" />
      <span>Forecast to Report</span>
      <span className="hidden font-mono text-[11px] font-normal tracking-[0.08em] text-[#9ED9E3]/70 sm:inline">combine in Library</span>
      <ArrowRight className="h-4 w-4 text-[#FF9B4C] transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}

/** Legacy /workbench/wiring: no global config any more. Send to the Library finance launcher, keeping the query. */
export function WiringRedirect() {
  const search = useSearch();
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate(financeLibraryHref(new URLSearchParams(search)), { replace: true });
    requestAnimationFrame(() => document.getElementById("combine")?.scrollIntoView());
  }, [search, navigate]);
  return null;
}
