---
name: Clerk API token forwarding
description: Preview authentication behavior when the frontend and API share an artifact proxy.
---

The web client must register Clerk's `getToken` with the shared API client's auth-token getter. Do not assume that browser Clerk cookies alone will reach the proxied API reliably; without the bearer-token bridge, authenticated frontend screens can show a valid Clerk user while API calls return 401.

**Why:** The Preview showed a signed-in Clerk user, but `/api/employees/me` remained unauthenticated until the API client explicitly forwarded the Clerk session token.

**How to apply:** When adding or troubleshooting Clerk-protected API calls in this workspace, verify the frontend auth bridge is mounted inside `ClerkProvider` and inspect API status codes after a browser refresh.