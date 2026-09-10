---
name: Cleaner workflow gates
description: Durable invariant for cleaner assigned-job workflow regression coverage.
---

Cleaner workflow coverage should verify assignment access, durable notes/checklist/proof rereads, unrelated-cleaner denial, active-clock rejection, required proof/checklist rejection, one successful completion, and repeated-completion rejection.

**Why:** Response-only assertions can miss persistence or authorization leaks, and completion must be a one-way state transition after the worker has clocked out.

**How to apply:** Use the real app middleware and database with disposable records, then reread each persisted artifact through its route before asserting the final transition.