import { SignIn, SignUp } from '@clerk/clerk-react';
import { Link } from 'wouter';
import type { ReactNode } from 'react';

const clerkAppearance = {
  elements: {
    rootBox: { width: '100%' },
    cardBox: { width: '100%', maxWidth: '400px', margin: '0 auto' },
  },
};

function AuthShell({ title, children, footer }: { title: string; children: ReactNode; footer: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: 'hsl(var(--background))', padding: '20px' }}>
      <div style={{ marginBottom: '32px', textAlign: 'center' }}>
        <img src="/mawii-logo.jpeg" alt="Mawii" style={{ width: '60px', height: '60px', borderRadius: '12px', marginBottom: '16px' }} />
        <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '-0.05em' }}>Mawii Operations Desk</h1>
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'hsl(var(--muted-foreground))' }}>{title}</p>
      </div>
      <div style={{ width: '100%', maxWidth: '400px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px' }}>
        {children}
        <p style={{ margin: 0, fontSize: '14px', textAlign: 'center', color: 'hsl(var(--muted-foreground))' }}>{footer}</p>
      </div>
    </div>
  );
}

export function SignInPage() {
  return (
    <AuthShell
      title="Sign in to continue"
      footer={<>New to Mawii? <Link href="/sign-up" data-testid="link-sign-up" style={{ fontWeight: 600 }}>Create an account</Link></>}
    >
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        forceRedirectUrl="/"
        appearance={clerkAppearance}
      />
    </AuthShell>
  );
}

export function SignUpPage() {
  return (
    <AuthShell
      title="Create your account to get started"
      footer={<>Already have an account? <Link href="/sign-in" data-testid="link-sign-in" style={{ fontWeight: 600 }}>Sign in</Link></>}
    >
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        forceRedirectUrl="/"
        appearance={clerkAppearance}
      />
    </AuthShell>
  );
}
