import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';
import { PersonaProvider } from '@/lib/persona';
import { Shell } from '@/components/shell';
import NotFound from '@/pages/not-found';
import Login from '@/pages/login';
import Home from '@/pages/home';
import Discover from '@/pages/discover';
import BriefPage from '@/pages/brief';
import Library from '@/pages/library';
import SolutionPage from '@/pages/solution';
import Cases from '@/pages/cases';
import Workspace from '@/pages/workspace';
import Review from '@/pages/review';
import Experiments from '@/pages/experiments';
import Portfolio from '@/pages/portfolio';
import Queue from '@/pages/queue';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } } });

function Router() {
  const [location] = useLocation();
  if (location === '/') return <Login />;
  return (
    <Shell>
      <RoutedErrorBoundary>
        <Switch>
          <Route path="/home" component={Home} />
          <Route path="/discover" component={Discover} />
          <Route path="/discover/:briefId" component={BriefPage} />
          <Route path="/library" component={Library} />
          <Route path="/library/:solutionId" component={SolutionPage} />
          <Route path="/cases" component={Cases} />
          <Route path="/cases/:caseId/review" component={Review} />
          <Route path="/cases/:caseId" component={Workspace} />
          <Route path="/experiments" component={Experiments} />
          <Route path="/portfolio" component={Portfolio} />
          <Route path="/portfolio/queue" component={Queue} />
          <Route component={NotFound} />
        </Switch>
      </RoutedErrorBoundary>
    </Shell>
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
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
            <Router />
          </WouterRouter>
        </PersonaProvider>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
