# @sudobility/whisperly_api

Backend API server for the Whisperly localization SaaS platform. Built with [Hono](https://hono.dev) on the [Bun](https://bun.sh) runtime, with PostgreSQL (Drizzle ORM), Firebase JWT auth, and subscription-based rate limiting (RevenueCat).

The core feature is a translation pipeline: a public endpoint that applies a per-project dictionary/glossary, forwards text to an external translation service, then restores glossary terms. Everything else (projects, dictionaries, analytics, entities/teams, invitations) is CRUD behind Firebase authentication.

## Requirements

- [Bun](https://bun.sh) (package manager and runtime — not npm/yarn)
- PostgreSQL
- Access to the private `@sudobility/*` packages on GitHub Packages (`.npmrc` points `@sudobility` at `npm.pkg.github.com`; export a `GH_PACKAGES_READ_TOKEN`/`NPM_TOKEN` with read access before `bun install`)

## Setup

```bash
bun install
cp .env.example .env   # Fill in DATABASE_URL, FIREBASE_*, TRANSLATION_SERVICE_URL
```

The database schema (schema `whisperly`, all tables, enums, indexes) is created automatically by `initDatabase()` on server startup. To set it up without starting the server:

```bash
bun run src/db/setup.ts
```

## Development

```bash
bun run dev          # Watch mode (listens on PORT, default 3000)
bun run start        # Run once (production entrypoint)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint src
bun run format       # prettier --write src
bun run test:unit    # Unit tests (vitest run) — no database, this is what CI runs
bun run verify       # typecheck + lint + test:unit
bun run db:studio    # Open Drizzle Studio
```

## Health Checks

| Route | Description |
|-------|-------------|
| `GET /` and `GET /health` | Basic liveness |
| `GET /health/detailed` | DB connectivity + translation/email/rate-limit config status |

## Routes

All API routes are mounted under `/api/v1`.

### Public (no auth, rate-limited per entity)
| Route | Description |
|-------|-------------|
| `POST /translate/:orgPath/:projectName` | Translation (core feature) |

### Authenticated (Firebase JWT)
| Route | Description |
|-------|-------------|
| `/entities` | Organization CRUD, members, invitations |
| `/entities/:entitySlug/projects` | Project CRUD + API key management |
| `/entities/:entitySlug/projects/:projectId/dictionary` | Dictionary/glossary CRUD |
| `/entities/:entitySlug/projects/:projectId/languages` | Project target languages |
| `/entities/:entitySlug/analytics` | Usage analytics |
| `/ratelimits/:rateLimitUserId` | Rate limit status (`:rateLimitUserId` is the entity slug) |
| `/invitations` | User-facing invitation accept/decline (by token) |
| `/users/:userId` / `/users/:userId/settings` | User info and settings |
| `/available-languages` | Supported target languages |

## Environment Variables

See `.env.example` for the full annotated list. Essentials:

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | -- | PostgreSQL connection (required) |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | -- | Firebase Admin credentials (required) |
| `TRANSLATION_SERVICE_URL` | -- | External translation service (mock fallback if unset and `TRANSLATION_MOCK_FALLBACK=true`) |
| `PORT` | 3000 | Server port |
| `SITEADMIN_EMAILS` | -- | Comma-separated admin emails (bypass rate limits) |
| `REVENUECAT_API_KEY` | -- | Subscription/rate-limit tiers (empty = free tier for all) |
| `RESEND_API_KEY` | -- | Invitation emails (empty = disabled) |

## Docker

```bash
docker build --build-arg GH_PACKAGES_TOKEN=<token> -t whisperly_api .
```

The container exposes and health-checks port `8021`, so set `PORT=8021` when running it.

## Related Packages

- `@sudobility/whisperly_types` -- shared type definitions
- `@sudobility/entity_service` -- entity/member/invitation management
- `@sudobility/auth_service`, `@sudobility/ratelimit_service`, `@sudobility/subscription_service`

## License

BUSL-1.1
