import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Redirect, Router as WouterRouter } from 'wouter';
import { PersonaProvider, useRole } from '@/lib/persona';
import { CaseProvider, httpStatus } from '@/lib/case';
import { MotionProvider } from '@/lib/motion';
import { Frame } from '@/components/frame';
import NotFound from '@/pages/not-found';
import SignIn from '@/pages/signin';
import DiscoverIntake from '@/pages/discover-intake';
import IntakeShell from '@/components/intake/Shell';
import Library from '@/pages/library';
import SolutionPage from '@/pages/solution';
import SearchPage from '@/pages/search';
import { WorkbenchRoute } from '@/pages/combined-case';
import FinanceWiringPage from '@/pages/finance-wiring';
import TestSessionPage from '@/pages/test-session';
import MySolutions from '@/pages/my-solutions';
import ImprovementPage from '@/pages/improvement';
import Portfolio from '@/pages/portfolio';
import DecisionPage from '@/pages/decision';

// A 4xx answer is final (a missing or removed record); retrying only leaves the page on a skeleton for seconds.
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false, retry: (count, err) => { const st = httpStatus(err); return !(st && st >= 400 && st < 500) && count < 2; } } } });

function Router() {
  const [location] = useLocation();
  const role = useRole();
  if (location === '/') return <SignIn />;
  if (role !== "it" && (location.startsWith("/portfolio") || location.startsWith("/my-solutions") || /^\/cases\/[^/]+\/decision/.test(location))) {
    return <Redirect to="/discover" />;
  }
  return (
    <Frame>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/discover" component={DiscoverIntake} />
          <Route path="/discover/records/:id" component={IntakeShell} />
          <Route path="/library" component={Library} />
          <Route path="/solutions/:id" component={SolutionPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/workbench/wiring" component={FinanceWiringPage} />
          <Route path="/workbench/:caseId" component={WorkbenchRoute} />
          <Route path="/cases/:caseId/decision" component={DecisionPage} />
          <Route path="/test/:sessionId" component={TestSessionPage} />
          <Route path="/my-solutions" component={MySolutions} />
          <Route path="/my-solutions/:solutionId/improvements/:key" component={ImprovementPage} />
          <Route path="/portfolio" component={Portfolio} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Frame>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <MotionProvider>
          <PersonaProvider>
            <CaseProvider>
              <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
                <Router />
              </WouterRouter>
            </CaseProvider>
          </PersonaProvider>
        </MotionProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
