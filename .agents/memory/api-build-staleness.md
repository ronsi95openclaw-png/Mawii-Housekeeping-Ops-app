---
name: API build staleness
description: API changes are compiled only when the API workflow starts, unlike the frontend's hot reload.
---

Restart the API workflow after pulling server-side changes before judging whether the fix worked. The frontend can show new UI code while the API is still serving an older compiled bundle.

**Why:** A stale API bundle previously kept returning the old behavior after the repository had the fix, causing repeated false diagnoses.

**How to apply:** Confirm the API build completes and record its fresh startup timestamp before testing server-backed flows such as imports, assignments, or job updates.