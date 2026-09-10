import { SignIn, SignUp } from '@clerk/clerk-react';
import { PageIntro } from '@/lib/shared';

export function SignInPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: 'hsl(var(--background))', padding: '20px' }}>
      <div style={{ marginBottom: '40px', textAlign: 'center' }}>
        <img src="/mawii-logo.jpeg" alt="Mawii" style={{ width: '60px', height: '60px', borderRadius: '12px', marginBottom: '16px' }} />
        <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '-0.05em' }}>Mawii Operations Desk</h1>
        <p style={{ margin: '8px 0 0', fontSize: '14px', color: 'hsl(var(--muted-foreground))' }}>Sign in to continue</p>
      </div>
      <SignIn routing="path" path="/sign-in" signUpUrl="/sign-up" forceRedirectUrl="/" />
    </div>
  );
}

export function SignUpPage() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '100dvh', background: 'hsl(var(--background))', padding: '20px' }}>
      <div style={{ marginBottom: '40px', textAlign: 'center' }}>
        <img src="/mawii-logo.jpeg" alt="Mawii" style={{ width: '60px', height: '60px', borderRadius: '12px', marginBottom: '16px' }} />
        <h1 style={{ margin: 0, fontSize: '24px', letterSpacing: '-0.05em' }}>Create an account</h1>
      </div>
      <SignUp routing="path" path="/sign-up" signInUrl="/sign-in" forceRedirectUrl="/" />
    </div>
  );
}
