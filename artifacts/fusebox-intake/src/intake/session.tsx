import { useQuery } from '@tanstack/react-query';
import { LogOut } from 'lucide-react';
import { asset } from './model';

export type SessionUser = { id: string; name: string };

export function useSession() {
  return useQuery({
    queryKey: ['/api/intake/session'],
    queryFn: async (): Promise<SessionUser | null> => {
      const res = await fetch('/api/intake/session', { credentials: 'same-origin' });
      if (!res.ok) throw new Error(`Session check failed (${res.status})`);
      const body = (await res.json()) as { user: { id?: string; name?: string } | null };
      return body.user ? { id: body.user.id ?? '', name: body.user.name ?? 'Signed in' } : null;
    },
    retry: 1,
  });
}

export const signIn = () => { window.location.href = `/api/login?returnTo=${encodeURIComponent(import.meta.env.BASE_URL)}`; };
export async function signOut() {
  try { await fetch('/api/logout', { method: 'POST', credentials: 'same-origin' }); } finally { window.location.reload(); }
}

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]?.toUpperCase()).join('') || 'ME';

export function Header({ user, view }: { user?: SessionUser | null; view?: 'seeker' | 'owner' }) {
  return <header className="fi-header">
    <div className="fi-brand"><img src={asset('brand/fusebox-logo-light.svg')} alt="FUSEBOX" style={{ height: 28, width: 'auto' }} /><span className="fi-brand-sub"><img src={asset('brand/cenovus-energy-logo.png')} alt="Cenovus Energy" style={{ height: 30, width: 'auto', background: 'white', padding: 6, borderRadius: 4 }} /></span></div>
    <div className="fi-header-right">
      {user && <>
        <span className="fi-person" data-testid="text-user"><span className="fi-avatar">{initials(user.name)}</span>{user.name}</span>
        {view && <span className="fi-label blue">{view === 'owner' ? 'IT Owner view' : 'Solution seeker view'}</span>}
        <button className="fi-btn" data-testid="button-logout" onClick={() => void signOut()}><LogOut />Sign out</button>
      </>}
    </div>
  </header>;
}
