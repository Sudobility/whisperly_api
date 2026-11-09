# CLAUDE.md - whisperly_api

> **Git policy — never auto-commit or auto-push.** Leave work in the working tree. Run
> `git commit`/`git push`/`gh pr create` **only when the user explicitly asks in that turn**.
> Finishing a task is not permission to commit it. Stay on the current branch (no feature branches).

## What it is

`@sudobility/whisperly_api` — backend REST API for the Whisperly localization SaaS. Hono app
on the **Bun** runtime. PostgreSQL via Drizzle ORM (schema `whisperly`), Firebase JWT auth, Zod
validation, Resend email, RevenueCat-based rate limiting. Private, BUSL-1.1. Backend only.

## Package manager: Bun

`bun install`, `bun run <script>`, `bun add <pkg>` — **not** npm/yarn. Bun runs TypeScript
directly (`tsconfig` is `noEmit`). `@sudobility/*` deps resolve from GitHub Packages
(`.npmrc` → `npm.pkg.github.com`); needs a read token to install.

## Commands (verified)

```bash
bun run dev          # watch-mode server (src/index.ts)
bun run start        # run once (Docker CMD / production)
bun run typecheck    # tsc --noEmit
bun run lint         # eslint src   (passes clean)
bun run format       # prettier --write src
bun run test:unit    # vitest run — 137 tests, no DB; this is what CI runs
bun run test:watch   # vitest watch
bun run test:db      # vitest --config vitest.db.config.ts (manual; see Testing)
bun run verify       # typecheck + lint + test:unit
bun run db:generate|db:migrate|db:push|db:studio   # drizzle-kit
```

There is **no `test` script** — `bun run test` silently runs the `/bin/test` shell builtin and
fails. Use `bun run test:unit`.

## Architecture

```
src/
├── index.ts            # Hono setup: error handler, CORS, logger, 2MB body limit,
│                       # health checks (/ , /health, /health/detailed), initDatabase(), server
├── config/             # languages.json (supported langs), rateLimits.ts (tier definitions)
├── db/
│   ├── index.ts        # lazy Proxy `db` + initDatabase() (creates schema/enums/tables/indexes)
│   ├── schema.ts       # Drizzle tables (see Tables)
│   └── setup.ts        # standalone schema setup → bun run src/db/setup.ts
├── lib/                # env-helper, error-codes, entity-config, entity-helpers
├── middleware/         # firebaseAuth.ts (JWT), rateLimit.ts (per-entity, RevenueCat)
├── routes/             # index.ts mounts all under /api/v1; one file per resource
├── schemas/index.ts    # Zod request schemas
└── services/           # translation, dictionaryCache, email (Resend), firebase
tests/                  # vitest; mirrors src/ layout; __mocks__/ holds alias mocks
drizzle/                # generated migrations
```

### Routing & auth (src/routes/index.ts)
- Everything under `/api/v1`. `POST /translate/:orgPath/:projectName` is the only **public** route.
- All other routes are mounted on an `adminRoutes` group with `firebaseAuthMiddleware` on `*`.
  **`/available-languages` is therefore authenticated**, despite being static config.
- `firebaseAuth` sets `c.get('userId')`, `userEmail`, `firebaseUser`, `siteAdmin`. Anonymous
  users rejected (403). Token verification cached 5 min. User record ensured in background.
- Entity permissions via `@sudobility/entity_service` helpers: owner > editor > viewer.

### Translation pipeline (core)
1. Load project dictionary cache → find terms in input → wrap as `{{term}}`.
2. Call external translation service (`TRANSLATION_SERVICE_URL`).
3. Replace `{{term}}` with the target-language dictionary translation.
4. Record usage to `usage_records` (non-blocking).
Extras: per-project API key (`wh_<hex>`, Bearer or `?api_key=`), IP allowlist, `?testMode=true`
debug info, `skip_dictionaries` bypass, placeholder-retry on unresolved brackets.

### Dictionary cache (services/dictionaryCache.ts)
In-memory, lazy per project, key `"entityId:projectId"`, invalidated on dictionary mutation.
Whole-word, case-insensitive, longest-match-first; indexes all language entries.

### Rate limiting
Per-entity, tied to RevenueCat tier: `none` (10/h,50/d,200/m), `whisperly`, `pro`, `enterprise`
(unlimited). Site-admin entities bypass. `?testMode=true` uses sandbox subscriptions. Disabled
gracefully when `REVENUECAT_API_KEY` unset. All singletons lazy-init (no env needed at import).

## Database

- `db` is a **lazy Proxy** — connecting on first query, but it does NOT run migrations; schema
  creation happens only inside `initDatabase()` (called on startup).
- Tables in `db/schema.ts`: `users`, `user_settings`, `projects`, `project_languages`,
  `dictionary`, `dictionary_entry`, `usage_records`. Entity tables (`entities`, `entity_members`)
  are created by `@sudobility/entity_service` factory functions during `initDatabase`, not here.
  There is **no** local rate-limit table (rate limiting is external via RevenueCat).
- Some routes need explicit column selection because bare `.select()` doesn't work on the
  entity_service factory-created tables.

## Testing

- Vitest, node env, tests in `tests/`. Mocking is via `resolve.alias` (not `vi.mock()`):
  `ratelimit_service`, `auth_service`, `entity_service` map to `tests/__mocks__/*`.
  **These aliases are duplicated in both `vitest.config.ts` and `vitest.db.config.ts`.**
- `@sudobility/subscription_service` has no mock; it's inlined via `server.deps.inline`
  (ships extensionless relative imports that Node's ESM resolver would reject).
- Two configs: `test:unit` excludes `**/*.db.test.ts` (CI never touches a DB); `test:db`
  collects only those files and runs manually (`fileParallelism: false`). No `*.db.test.ts`
  files exist yet, so `test:db` exits non-zero with "No test files found" — expected.
- DB suites use **`TEST_DATABASE_URL`** (must be exactly `localhost`); `tests/setup.ts` deletes
  `DATABASE_URL` so unit tests cannot reach a real DB.

## Conventions

- Responses via `successResponse()` / `errorResponse()` from `@sudobility/whisperly_types`.
  Some errors add an `errorCode` (`ErrorCode` enum in `src/lib/error-codes.ts`) for client i18n.
- Validation: `zValidator("json"|"param"|"query", schema)` with schemas from `src/schemas`.
- Env read via `getEnv()`/`getRequiredEnv()` (`src/lib/env-helper.ts`): `.env.local` → `.env` → `process.env`.
- Each route file creates its own `createEntityHelpers(config)` (intentional per-route singleton).
- `getEntityWithPermission` is duplicated across `dictionary.ts`, `project-languages.ts`,
  `projects.ts` (projects.ts variant adds `errorCode`).

### Adding a route
1. New file in `src/routes/`. 2. Zod schema in `src/schemas/index.ts`. 3. Mount in
`src/routes/index.ts` (under `adminRoutes` for authed routes). 4. Add tests mirroring the dir.

## Gotchas

- **Docker port**: Dockerfile `EXPOSE`s and health-checks `8021`, but the app listens on `PORT`
  (default 3000). Set `PORT=8021` in the container or the health check fails.
- **Docker build arg** is `GH_PACKAGES_TOKEN` (writes `~/.npmrc` for GitHub Packages), not `NPM_TOKEN`.
- **Frontend port**: `whisperly_app` defaults its API base to `http://localhost:3001`; align ports.
- No `bunfig.toml` — it was dead Bun-test config (the runner is vitest) and was removed; the
  Dockerfile `COPY ... bunfig.toml*` glob tolerates its absence.

## CI

`.github/workflows/ci-cd.yml` calls the reusable `johnqh/workflows/.../unified-cicd.yml`. `main`
runs tests and deploys the Docker image (Docker Hub); npm publish is skipped (API server, not a lib).
