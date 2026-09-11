---
name: Employee lifecycle cleanup
description: Employee-scoped onboarding and notification records must not block normal employee retirement or test fixture cleanup.
---

Employee-linked onboarding tokens and in-app notifications use database-level cascade behavior when an employee is removed.

**Why:** Employee profiles can be pending, claimed, deactivated, or removed during operational cleanup. Orphaned lifecycle rows should not turn a valid employee deletion into a foreign-key failure.

**How to apply:** Any new employee-scoped table should either cascade on employee deletion or explicitly document why it must retain history independently.