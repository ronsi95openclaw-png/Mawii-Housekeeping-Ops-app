import { SignIn } from '@clerk/clerk-react';

export function SignInPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: 'hsl(var(--background))', padding: '20px' }}>
      <div style={{ marginBottom: '40px', textAlign: 'center' }}>
        <img src="/mawii-logo.jpeg" alt="Mawii" style={{ width: '60px', height: '60px', borderRadius: '12px', marginBottom: '16px' }} />
        <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '-0.05em' }}>Mawii Operations Desk</h1>
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'hsl(var(--muted-foreground))' }}>Sign in to continue</p>
      </div>
      <SignIn
        routing="path"
        path="/sign-in"
        forceRedirectUrl="/"
        appearance={{ elements: { footerAction: 'hidden' } }}
      />
    </div>
  );
}
