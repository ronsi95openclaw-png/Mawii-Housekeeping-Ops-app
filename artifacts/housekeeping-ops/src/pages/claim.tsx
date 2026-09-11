import { useState, type FormEvent } from 'react';
import { useClaimEmployee } from '@workspace/api-client-react';
import { ShieldCheck } from 'lucide-react';

export function ClaimEmployee({ onClaimed }: { onClaimed: () => void }) {
  const claim = useClaimEmployee();
  const [token, setToken] = useState('');

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!token.trim()) return;
    claim.mutate({ data: { token: token.trim() } }, { onSuccess: onClaimed });
  };

  return (
    <main className="auth-page">
      <form className="auth-card panel" onSubmit={submit}>
        <div className="auth-mark"><ShieldCheck size={20} /></div>
        <span className="eyebrow">Secure onboarding</span>
        <h1>Connect your cleaner account</h1>
        <p className="muted-copy">Ask an owner for the one-time onboarding code, then paste it here. This Clerk account will be linked to your field profile.</p>
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
      </form>
    </main>
  );
}