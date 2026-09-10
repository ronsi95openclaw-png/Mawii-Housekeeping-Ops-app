---
name: Elevate job intake
description: Source choice and timezone rules for importing Elevate OS appointments into Mawii.
---

Use GoHighLevel outbound workflow webhooks as the supported Elevate OS appointment intake channel. Interpret appointment instants in `America/Chicago` before storing Mawii's calendar date and clock time.

**Why:** This Elevate OS offering is built on GoHighLevel, no direct Replit connector was available, and Mawii operates in the DFW area. Storing UTC clock values shifted local appointments and could move them to the wrong day.

**How to apply:** Keep the webhook contract compatible with GoHighLevel workflow payloads. Any future calendar, email, API, or export importer must normalize date/time values to `America/Chicago` and reuse the same external appointment identity.