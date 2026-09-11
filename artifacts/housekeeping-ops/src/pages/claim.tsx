import { useState, type FormEvent } from 'react';
import { useUser } from '@clerk/clerk-react';
import { useClaimEmployee } from '@workspace/api-client-react';
import { ShieldCheck, Copy, Check } from 'lucide-react';

export function ClaimEmployee({ onClaimed }: { onClaimed: () => void }) {
  const claim = useClaimEmployee();
  const { user } = useUser();
  const [token, setToken] = useState('');
  const [copied, setCopied] = useState(false);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    claim.mutate({ data: { token: token.trim() } }, { onSuccess: onClaimed });
  };

  const copyUserId = async () => {
    if (!user?.id) return;
    await navigator.clipboard.writeText(user.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <main className="auth-page">
      <form className="auth-card panel" onSubmit={submit}>
        <div className="auth-mark"><ShieldCheck size={20} /></div>
        <span className="eyebrow">Secure onboarding</span>
        <h1>Connect your account</h1>
        <p className="muted-copy">Your sign-in worked, but this account is not linked to a Mawii profile yet. Cleaners: paste the one-time code from your owner.</p>
        <label>
          One-time onboarding code
          <input
            autoFocus
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder="Paste the code from your owner"
            autoComplete="one-time-code"
          />
        </label>
        {claim.isError && <p className="form-error">That code is invalid, expired, or already used.</p>}
        <button className="button button-primary" disabled={!token.trim() || claim.isPending}>
          {claim.isPending ? 'Connecting…' : 'Connect account'}
        </button>
        {user?.id && (
          <div style={{ marginTop: '20px', paddingTop: '16px', borderTop: '1px solid hsl(var(--border))' }}>
            <p className="muted-copy">Joining as an owner or manager instead? Send this ID to an owner so they can add you from the Team page.</p>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap', marginTop: '8px' }}>
              <code style={{ flex: '1 1 180px', padding: '10px', wordBreak: 'break-all', background: 'hsl(var(--secondary))', borderRadius: '8px', fontSize: '11px' }} data-testid="text-clerk-user-id">{user.id}</code>
              <button type="button" className="button button-secondary" onClick={copyUserId} data-testid="button-copy-clerk-user-id">
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        )}
      </form>
    </main>
  );
}
