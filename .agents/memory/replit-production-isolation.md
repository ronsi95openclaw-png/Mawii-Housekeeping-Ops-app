---
name: Replit production isolation
description: Replit-managed Clerk and PostgreSQL development/production separation for publish preparation.
---

Replit-managed Clerk has isolated Development and Production user stores, and publishing uses a separate production PostgreSQL database. If development data is copied during publishing, employee rows retain their development Clerk user IDs and must be relinked to the corresponding production accounts.

**Why:** Clerk user IDs do not cross environments, so copied employee records can otherwise send real users to the account-connection flow after launch.

**How to apply:** Before publishing, decide whether development data is safe to copy, create or sign in the real Production users, and verify each employee record is linked to its Production Clerk ID. The frontend publish build must use the Production publishable key context.