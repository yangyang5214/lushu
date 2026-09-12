# Lushu

[简体中文](README.md) ｜ **English**

A route-book planner and sharing app built on Cloudflare Pages + D1: search places, plan driving routes, and turn multi-day trips into a shareable book. React + Vite on the front end, Pages Functions on the back end.

## Quick start

### Prerequisites

- Node.js 18+ and pnpm
- Nothing else — Wrangler brings its own local D1 (SQLite)

### First-time setup

```bash
pnpm install
pnpm wrangler login                     # authorize Wrangler once
pnpm wrangler d1 create lushu           # note the returned database_id
cp wrangler.toml.example wrangler.toml  # put database_id into wrangler.toml
pnpm db:init:local                      # create local D1 tables (once)
```

`wrangler.toml` is gitignored; only `wrangler.toml.example` is committed.

`schema.sql` is idempotent: tables use `IF NOT EXISTS` and newer fields (such as book
visibility) live inside the book JSON, so there is no separate migration script —
just run `db:init` again on an existing database.

### Run

**UI only (Vite):**

```bash
pnpm dev          # http://localhost:5173
```

Search works (`/api/geocode` is proxied to Nominatim by Vite); driving routes go through the local Worker (`/api/route`, i.e. `pnpm pages:dev` below) and fall back to a direct OSRM call in the browser when the Worker is not running. Accounts, cloud library and public books also need the Worker below.

**Full stack (real Worker + local D1):**

```bash
pnpm pages:dev    # build, then start the Worker on http://localhost:8788
```

**HMR + real D1:** run `pnpm dev` in a second terminal; Vite forwards `/api/books`, `/api/library`, etc. to the Worker on 8788 (override with `LUSHU_API`).

## UI language

The UI ships in Simplified Chinese and English; toggle it from the top-right of the header. The first visit follows your browser language and the choice is remembered. A new book's default title uses whichever language was active when it was created.

## Deploy

```bash
pnpm deploy       # wrangler pages deploy dist
```

Secrets never live in front-end code; set them with `wrangler pages secret put` (or `.dev.vars` locally):

| Secret | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Send activation emails |
| `TURNSTILE_SECRET` | Human check on register / sign-in |
| `ADMIN_SECRET` | Passphrase for `/admin` (min 16 chars); `/api/admin/*` returns 404 when unset or too short |

> Auth entrypoints (sign-in / register / resend activation / admin sign-in) are rate limited
> via the D1 `rate_limits` table. Re-run `pnpm db:init` (or `pnpm db:init:local`) once after upgrading.
| `AMAP_KEY` | AMap "Web Service" key (not a JS API key), used for driving routes |

Other tunables (`MAX_BOOKS`, `MAX_DOC_BYTES`, …) are documented in `wrangler.toml.example`.

## Scripts

```bash
pnpm dev          # Vite dev server only
pnpm pages:dev    # build, then run the local Worker + D1
pnpm build        # type-check + build to dist/
pnpm preview      # preview the build output
pnpm lint         # oxlint
pnpm db:init:local / pnpm db:init   # init local / remote D1
```
