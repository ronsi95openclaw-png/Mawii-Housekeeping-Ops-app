import { createRoot } from 'react-dom/client';
import { useEffect } from 'react';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { setAuthTokenGetter } from '@workspace/api-client-react';
import App from './App';
import { ErrorBoundary } from '@/components/error-boundary';

import './index.css';

const clerkPubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

function ApiAuthBridge() {
  const { getToken } = useAuth();

  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    return () => setAuthTokenGetter(null);
  }, [getToken]);

  return <App />;
}

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <ClerkProvider publishableKey={clerkPubKey}>
      <ApiAuthBridge />
    </ClerkProvider>
  </ErrorBoundary>,
);
