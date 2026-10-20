import { Link } from "wouter";
import { btnPrimary } from "@/components/kit";

export default function NotFound() {
  return (
    <div className="flex min-h-[70dvh] flex-col items-center justify-center text-center">
      <div className="font-display text-[120px] font-extrabold leading-none text-primary">404</div>
      <h1 className="mt-2 text-2xl font-bold">No product lives at this address.</h1>
      <p className="mt-2 max-w-sm text-muted-foreground">Which, for once, is not a duplicate. Head back and pick up where you left off.</p>
      <Link href="/home" className={`${btnPrimary} mt-6`} data-testid="link-go-home">Back to home</Link>
    </div>
  );
}
