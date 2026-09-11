---
name: GitHub push fallback
description: Reliable GitHub write path when the local HTTPS Git remote lacks usable credentials.
---

When the local HTTPS Git remote rejects authentication, the installed GitHub integration can update the repository through the authenticated Git Data API without exposing a token.

**Why:** Replit's GitHub integration may remain authorized even when the local Git credential helper cannot authenticate the remote URL.

**How to apply:** Verify the remote branch first, create the required blob/tree/commit through the connector, update the branch with `force: false`, then fetch and align the local branch.