---
name: Owner report boundaries
description: Durable testing and timezone constraint for owner operational reports.
---

Owner report regressions should use fixed future calendar dates that cannot overlap existing operational or prior-test records, and date-only ranges should be interpreted in the DFW business timezone.

**Why:** Reusing the current week allowed unrelated jobs to contaminate the fixture, while UTC-midnight boundaries misclassified legitimate Central-time Sunday and Saturday records.

**How to apply:** Build report fixtures with disposable future dates and assert both date-boundary inclusions and exclusions, including Central-time edge timestamps.