import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

/** Accessible light/dark switch. `onDark` = rendered on the Electric Ink chrome (sign-in band). */
export function ThemeToggle({ onDark, className }: { onDark?: boolean; className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={dark}
      aria-label="Dark theme"
      title={dark ? "Switch to light theme" : "Switch to dark theme"}
      data-testid="button-theme-toggle"
      className={cn(
        "grid h-9 w-9 shrink-0 place-items-center rounded-lg transition-colors",
        onDark ? "text-white/80 hover:bg-white/10 hover:text-white" : "text-primary hover:bg-secondary",
        className,
      )}
    >
      {dark ? <Sun className="h-[18px] w-[18px]" /> : <Moon className="h-[18px] w-[18px]" />}
    </button>
  );
}
