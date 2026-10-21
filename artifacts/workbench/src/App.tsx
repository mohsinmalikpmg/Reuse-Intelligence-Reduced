import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { PersonaProvider } from '@/lib/persona';
import { CaseProvider } from '@/lib/case';
import { Frame } from '@/components/frame';
import NotFound from '@/pages/not-found';
import SignIn from '@/pages/signin';
import Discover from '@/pages/discover';
import Library from '@/pages/library';
import SolutionPage from '@/pages/solution';
import SearchPage from '@/pages/search';
import Workbench from '@/pages/workbench';
import TestSessionPage from '@/pages/test-session';
import MySolutions from '@/pages/my-solutions';
import ImprovementPage from '@/pages/improvement';
import Portfolio from '@/pages/portfolio';
import DecisionPage from '@/pages/decision';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } });

function Router() {
  const [location] = useLocation();
  if (location === '/') return <SignIn />;
  return (
    <Frame>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/discover" component={Discover} />
          <Route path="/library" component={Library} />
          <Route path="/solutions/:id" component={SolutionPage} />
          <Route path="/search" component={SearchPage} />
          <Route path="/workbench/:caseId" component={Workbench} />
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
        <PersonaProvider>
          <CaseProvider>
            <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
              <Router />
            </WouterRouter>
          </CaseProvider>
        </PersonaProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
