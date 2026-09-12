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

## Data and accounts

- Search and routing (`/api/geocode`, `/api/route`) work without signing in.
- Driving routes prefer AMap: set `AMAP_KEY` (an AMap "Web Service" key, via `wrangler pages secret put AMAP_KEY`) and `/api/route` uses AMap driving directions; when it is missing or AMap fails, the route falls back to OSRM. AMap keys have a low concurrent QPS, so multi-day routes are sent serially and retried on rate limits to avoid the fallback. Route coordinates are always returned as GCJ02 to line up with the AMap basemap.
- Personal data always requires signing in: My Books, creating / duplicating a book, editing and saving, the cloud shelf, and cross-device recovery. When signed out, those actions first jump to the account page and finish automatically once you sign in or register.
- Books are public by default: a new book shows up on the Public books page and anyone with the link can open it. A book link looks like `/{userId}/{bookId}`, where `userId` is the owner's public short ID (the "user ID" on the account page, derived from the email — not a credential); an old link with just `/{bookId}` still opens. In the My Books list you can flip a book to "only me" — it disappears from the public list and the old link stops working for everyone else (the server pretends it does not exist); only the owner can read it. Flipping it back to public works the same way.
- Storage stays local-first: the UI writes to the browser immediately, then pushes to D1 after a 1.4s debounce. Signing in only attaches local data to the account; the cloud copy is what survives a device change.
- Signing out clears the local cache (books, tokens, owner key). Cloud data stays with the account and comes back on the next sign-in.
- These rules are documented here only; the UI does not explain them.

## Deploy

```bash
pnpm deploy       # wrangler pages deploy dist
```

Secrets never live in front-end code; set them with `wrangler pages secret put` (or `.dev.vars` locally):

| Secret | Purpose |
| --- | --- |
| `RESEND_API_KEY` | Send activation emails |
| `TURNSTILE_SECRET` | Human check on register / sign-in |
| `ADMIN_SECRET` | Passphrase for `/admin`; `/api/admin/*` returns 404 when unset |
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
