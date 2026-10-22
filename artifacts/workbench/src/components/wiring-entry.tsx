import { Link } from "wouter";
import { ArrowRight, Cable } from "lucide-react";
import { cn } from "@/lib/utils";

/** Discoverable entry into the Finance wiring view (lives inside Workbench; not a separate nav destination). */
export function WiringEntry({ className, testid = "link-finance-wiring" }: { className?: string; testid?: string }) {
  return (
    <Link href="/workbench/wiring" data-testid={testid}
      className={cn("group inline-flex min-h-10 items-center gap-2.5 rounded-xl border border-[#173D4A] bg-[#081F29] px-3.5 text-[13.5px] font-semibold text-[#D9EFF2] transition-colors hover:border-[#CE7642]", className)}>
      <Cable className="h-4 w-4 text-cyan" />
      <span>Finance wiring</span>
      <span className="hidden font-mono text-[11px] font-normal tracking-[0.08em] text-[#9ED9E3]/70 sm:inline">forecast to report · live config</span>
      <ArrowRight className="h-4 w-4 text-[#FF9B4C] transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
