# Housekeeping Ops

An operations desk for coordinating housekeeping jobs, crew assignments, reminders, checklists, and proof-of-service documentation.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/housekeeping-ops/src/App.tsx` — responsive operations dashboard and workflows
- `artifacts/housekeeping-ops/src/index.css` — product theme and responsive styles
- `lib/api-spec/openapi.yaml` — source of truth for job, team, activity, dashboard, checklist, and messaging APIs
- `artifacts/api-server/src/routes/operations.ts` — operations API handlers and dev seed data
- `lib/db/src/schema/operations.ts` — PostgreSQL schema for jobs and team members

## Architecture decisions

- Calendar days use date-only storage in PostgreSQL to avoid timezone shifts in schedule views.
- Owners and managers operate MAWII as the communication control center. Employee communication is WhatsApp-first for assignments, reminders, schedule changes, operational updates, and job information; these actions are owner/manager-triggered and do not become an employee inbox.
- Customer communication is SMS-first for confirmations, reminders, ETA/service updates, completion notices, and rescheduling. Twilio remains deferred until internal operations are complete.
- Outbound communication records are provider-neutral and retain channel, audience, queued/delivery status, provider metadata, and job context so Twilio SMS history can be connected later without changing the workflow.
- Job checklists and proof-photo metadata travel with the job record so the closeout view stays focused on one work order.

## Product

Housekeeping Ops gives owners a live overview of today’s work, a visual week schedule, searchable jobs, a team roster, checklist closeout, proof-photo display, and job-level client messaging. It is designed for the two-person operations desk that receives jobs from Elevate OS and dispatches the field team.

MAWII is a single-company internal operations app for Mawii Property Care only. It is not SaaS, multi-tenant, for resale, or for rental to other companies. Do not add subscriptions, tenant isolation, public signup, customer billing, usage metering, organization switching, SaaS onboarding, or a customer portal without explicit instruction.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- After changing `lib/api-spec/openapi.yaml`, run `pnpm --filter @workspace/api-spec run codegen` before typechecking the server or frontend.
- The API seed is only for the development workspace; production records should come from the authenticated app flow.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
