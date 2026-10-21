import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Route, Switch, useLocation, useParams, Link, Router as WouterRouter } from 'wouter';
import { LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import '@/intake/Interactive.css';
import { Header, signIn, useSession } from '@/intake/session';
import Records from '@/intake/Records';
import Editor from '@/intake/Editor';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } });

function EditorRoute() {
  const params = useParams<{ id: string }>();
  return <Editor id={params.id ?? ''} />;
}

function Missing() {
  return <div className="fi-wrap"><div className="fi-empty"><h3>Nothing lives at this address.</h3><Link href="/" className="fi-btn" style={{ marginTop: 14 }}>All intakes</Link></div></div>;
}

function SignIn() {
  return <div className="fi-wrap"><div className="fi-stage">01 / Trace · Shared understanding</div>
    <div className="fi-intro"><div><h1>Bring the problem.<br /><em>And what you’ve tried.</em></h1><p>Sign in to start an intake, save your inputs and return to them later. Each intake is visible only to the account that created it.</p></div></div>
    <div className="fi-card fi-signin"><ShieldCheck /><div><h3>Sign in to continue</h3><p className="fi-hint">Your intakes, files and confirmed profiles are tied to your own account.</p></div><button className="fi-btn primary" data-testid="button-login" onClick={signIn}><LogIn />Log in</button></div>
  </div>;
}

function Shell() {
  const { data: user, isLoading, error, refetch } = useSession();
  const [location] = useLocation();
  return <main className="fi">
    <Header user={user} view={user ? 'seeker' : undefined} />
    {isLoading ? <div className="fi-wrap"><div className="fi-skel" style={{ height: 40, width: 300 }} /><div className="fi-skel" style={{ height: 160, marginTop: 20 }} /></div>
      : error ? <div className="fi-wrap"><div className="fi-empty"><h3>We could not check your sign-in.</h3><p className="fi-hint">{error.message}</p><button className="fi-btn" style={{ marginTop: 14 }} onClick={() => void refetch()}><RefreshCw />Retry</button></div></div>
      : !user ? <SignIn />
      : <ErrorBoundary resetKey={location}><Switch>
          <Route path="/" component={Records} />
          <Route path="/records/:id" component={EditorRoute} />
          <Route component={Missing} />
        </Switch></ErrorBoundary>}
  </main>;
}

function App(): ReactNode {
  return <QueryClientProvider client={queryClient}>
    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Shell /></WouterRouter>
  </QueryClientProvider>;
}

export default App;
