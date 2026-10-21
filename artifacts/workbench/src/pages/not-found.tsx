import { Link } from "wouter";
import { Page, btn } from "@/components/bits";

export default function NotFound() {
  return (
    <Page className="md:pt-20">
      <div className="eyebrow">404</div>
      <h1 data-testid="text-headline" className="mt-2 text-[38px] font-bold leading-tight">This page does not exist.</h1>
      <p className="mt-2 text-lg text-muted-foreground">The link may be old. The library is a good place to start again.</p>
      <div className="mt-8 flex gap-3">
        <Link href="/library" data-testid="link-library" className={btn.primary}>Open the library</Link>
        <Link href="/discover" data-testid="link-discover" className={btn.secondary}>Describe a problem</Link>
      </div>
    </Page>
  );
}
