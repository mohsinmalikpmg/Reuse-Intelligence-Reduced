import { LogIn, RefreshCw, ShieldCheck } from 'lucide-react';
import { useParams } from 'wouter';
import { signIn, useSession } from './session';
import { errorMessage } from './model';
import Records from './Records';
import Editor from './Editor';
import './Interactive.css';

function SignIn() {
  return <div className="fi-wrap"><div className="fi-stage">01 / Trace · Shared understanding</div>
    <div className="fi-intro"><div><h1>Bring the problem.<br /><em>And what you’ve tried.</em></h1><p>Sign in to start an intake, save your inputs and return to them later. Each intake is visible only to the account that created it.</p></div></div>
    <div className="fi-card fi-signin"><ShieldCheck /><div><h3>Sign in to continue</h3><p className="fi-hint">Your intakes, files and confirmed profiles are tied to your own account.</p></div><button className="fi-btn primary" data-testid="button-login" onClick={signIn}><LogIn />Log in</button></div>
  </div>;
}

/** Intake authentication is local to Discover, not a gate on the workbench. */
export default function IntakeShell() {
  const { data, isLoading, error, refetch } = useSession();
  const { id } = useParams<{ id?: string }>();
  const user = data?.user;
  return <div className="fi" data-testid="intake-shell">
    {isLoading ? <div className="fi-wrap"><div className="fi-skel" style={{ height: 40, width: 'min(300px, 100%)' }} /><div className="fi-skel" style={{ height: 160, marginTop: 20 }} /></div>
      : error ? <div className="fi-wrap"><div className="fi-empty"><h3>We could not check your sign-in.</h3><p className="fi-hint">{errorMessage(error)}</p><button className="fi-btn" data-testid="button-retry-session" style={{ marginTop: 14 }} onClick={() => void refetch()}><RefreshCw />Retry</button></div></div>
      : !user ? <SignIn />
      : id ? <Editor key={`${user.id}-${id}`} id={id} /> : <Records key={user.id} />}
  </div>;
}
