# Lushu

[简体中文](README.md) ｜ **English**

Search for the places you want to visit, let Lushu string them into a sensible driving route, then split the trip into days at your overnight stops — a shareable multi-day road-book in a few minutes.

React + Vite on the front end, Cloudflare Pages Functions + D1 on the back end, AMap for maps and driving routes. Editing is **local-first**: changes land in the browser, then persist to D1 after a 1.4s debounce.

[![License](https://img.shields.io/badge/license-MIT-brightgreen?style=flat-square)](LICENSE)
[![Live](https://img.shields.io/badge/live-lushu.fittools.cc-00a67e?style=flat-square)](https://lushu.fittools.cc)
[![Stars](https://img.shields.io/github/stars/yangyang5214/lushu?style=flat-square&label=stars)](https://github.com/yangyang5214/lushu/stargazers)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square&logo=typescript&logoColor=white)](tsconfig.app.json)
[![React](https://img.shields.io/badge/React-19-61dafb?style=flat-square&logo=react&logoColor=white)](package.json)
[![Cloudflare Pages + D1](https://img.shields.io/badge/Cloudflare-Pages%20%2B%20D1-f38020?style=flat-square&logo=cloudflare&logoColor=white)](wrangler.toml.example)

**[Live demo](https://lushu.fittools.cc)** ｜ [Issues](https://github.com/yangyang5214/lushu/issues) ｜ [Commits](https://github.com/yangyang5214/lushu/commits/main)

## Contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Deploy](#deploy)
- [Design notes](#design-notes)
- [Companion projects](#companion-projects)
- [Known limitations](#known-limitations)
- [Contributing](#contributing)
- [License](#license)
- [Credits](#credits)

## Features

- **Add places freely** — search cities, temples, old streets or campsites and drop them in. No ordering, no need to decide day one yet. Search goes through AMap POI lookup (cached for 3 days) and falls back to a bundled gazetteer when the Worker is not running.
- **Tap the map for a place** — click anywhere on a roadbook map and a card for the nearest AMap place opens on the right: rating, photos (mostly user review images), phone, opening hours, address and straight-line distance, plus a link to the full reviews on AMap and a list of nearby alternatives to switch to. Confirm with “Add to route” to drop it into the current roadbook (read-only shares show no such action).
- **Automatic route ordering** — set a start and an end and the route is re-ordered by driving distance; loops can run clockwise or counter-clockwise. The map colours the route per day, adds direction arrows and shows distance and driving time between stops.
- **Overnight splitting** — click a bead on the trip ruler to mark an overnight stop, or drag the divider pin. The trip becomes day-by-day with per-day mileage and legend, and day count updates instantly.
- **Cloud library** — edits land locally first and are written to D1 after a 1.4s debounce. `/list` manages your books, `/public` browses public ones, and cards draw a real route thumbnail.
- **Sharing and visibility** — a `/d/{userId}/{bookId}` link is readable by anyone (read-only view drops all editing affordances). Switch a book between public and private at any time; private books return 404 to everyone but the owner.
- **Accounts** — email + password sign-up with email activation; passwords are stored as salted PBKDF2-SHA256, and the session cookie only carries a token digest. The UI ships in Chinese and English.
- **Feature guide** — below the hero, the home page walks through the editor controls one by one (add a place, start/end, overnight splitting, the trip ruler, distance and drive time), each with a diagram of the editor and copy in both languages.

## Tech stack

| Layer | Choice |
| --- | --- |
| Front end | React 19 · TypeScript (strict) · Vite 8 · Zustand 5 |
| Styling | Hand-written CSS (`src/index.css`, `src/home.css`), no UI framework |
| Back end | Cloudflare Pages Functions (a Worker underneath) |
| Database | Cloudflare D1 (SQLite); every read/write uses bound parameters |
| Maps | AMap JS API (basemap, markers, route rendering) · AMap Web Service API (POI search, driving routes) |
| Email · bot check | Resend (optional) · Cloudflare Turnstile (optional) |
| Tooling | pnpm · oxlint · wrangler |

## Repository layout

```
src/            React front end: App.tsx, store.ts, components/, lib/ (amap, geocode, route, sync, i18n…)
functions/      Pages Functions: api/[[path]].ts (all API routes), lib/ (auth, mail, rate-limit, admin…)
shared/         Pure functions and types shared by both sides: coordinate conversion, route ordering, password rules, public config, place-card types
schema.sql      D1 schema; idempotent, no separate migration scripts
public/         Static assets: favicon, icons, mini-program QR code, sitemap.xml, robots.txt
scripts/        Local dev script: dev.mjs starts Vite + the local Worker + local D1 (`pnpm dev:all`)
```

## Getting started

### Prerequisites

- Node.js **22.12+** and pnpm (Vite 8 requires `^20.19.0 || >=22.12.0` and wrangler requires `>=22`; on older versions `vite build` fails because `node:util` has no `styleText`)
- No database to install: Wrangler brings its own local D1 (SQLite)

### First-time setup

```bash
pnpm install
pnpm wrangler login                     # authorize Wrangler once
pnpm wrangler d1 create lushu           # note the returned database_id
cp wrangler.toml.example wrangler.toml  # put database_id into wrangler.toml
pnpm db:init:local                      # create local D1 tables
```

`wrangler.toml` is gitignored; only `wrangler.toml.example` is committed.

`schema.sql` is idempotent: tables use `IF NOT EXISTS` and newer fields (such as book visibility) live inside the book JSON, so there is no separate migration script — just run `db:init` again on an existing database.

### Run

| Goal | Command | URL |
| --- | --- | --- |
| **Local full stack (recommended)** | `pnpm dev:all` | 5173 (HMR) + 8788 (Worker) together, `/api/*` already proxied |
| UI only | `pnpm dev` | http://localhost:5173 |
| Back end only | `pnpm pages:dev` | http://localhost:8788 (builds first, then starts the Worker) |
| Manual combo | `pnpm pages:dev` in one terminal, `pnpm dev` in another | 5173; `/api/*` is proxied to 8788 (override with `LUSHU_API`) |

`pnpm dev:all` creates `wrangler.toml` if missing, runs the idempotent `schema.sql` against local D1, builds `dist/` when needed, waits for the Worker and then starts Vite; one Ctrl-C stops both. Flags: `--web-port` / `--api-port` / `--skip-db-init` / `--skip-build` / `--check` (preflight only).

With `pnpm dev` alone you get the front end only: search degrades to the bundled gazetteer (`src/lib/gazetteer.ts`), routes are not drawn, and accounts / my books / public books are unavailable — search and driving routes use AMap only and need the Worker with `AMAP_KEY` configured.

### Common scripts

```bash
pnpm dev:all      # one command for the local full stack (Vite + Worker + D1)
pnpm build        # type-check (front end + functions) then build to dist/
pnpm lint         # oxlint
pnpm preview      # preview the build output
pnpm db:init:local / pnpm db:init   # create local / remote D1 tables
pnpm deploy       # deploy to Cloudflare Pages
```

## Configuration

Public front-end variables live in `[vars]` inside `wrangler.toml` and are injected at build time (see `vite.config.ts`). Secrets never enter front-end code: use `.dev.vars` locally and `wrangler pages secret put` in production.

### Public variables (`[vars]`)

| Variable | Default | Purpose |
| --- | --- | --- |
| `AMAP_JS_KEY` | empty | AMap **JS API** key. Basemap, markers and route rendering all depend on it, so it is **required**. It is a public key (it ships in the bundle) — bind a site-domain allowlist to it in the AMap console. |
| `AMAP_SECURITY_CODE` | empty | Optional JS API 2.0 security code (the "security key" in the console); only needed for plugin features. |
| `TURNSTILE_SITE_KEY` | empty | Optional Cloudflare Turnstile site key; the front-end human check only appears when set. |
| `MAX_BOOKS` | `20000` | Soft cap on total books; `0` means unlimited. Keeps the D1 free 5 GB quota from being filled. |
| `MAX_DOC_BYTES` | `262144` | Max JSON size per book (roughly 300 places). |

### Secrets

| Name | Required | Purpose |
| --- | --- | --- |
| `AMAP_KEY` | yes (search / routes) | AMap **Web Service** key — *not* the JS API key above. `/api/places` (search), `/api/poi` (tap-for-a-place) and `/api/route` (driving) rely on it and return 5xx when unset. Multiple keys are supported as `key1;key2`: they rotate to spread quota and back each other up. |
| `ADMIN_SECRET` | no | Passphrase for the `/admin` console, at least 6 characters. When unset or too short, every `/api/admin/*` route returns 404 — the console effectively does not exist. |
| `RESEND_API_KEY` | no | Sends sign-up activation emails; without it the registration flow is unusable. |
| `TURNSTILE_SECRET` | no | Human-check secret for register / sign-in / resend activation; setting it makes the check mandatory. |
| `EMAIL_FROM` | no | Sender, defaulting to `路书 <onboarding@resend.dev>`; verify your domain in Resend before switching. |
| `SESSION_TTL_DAYS` | no | Session lifetime in days, default `30`. |

Setting them:

```bash
pnpm secret:amap        # = wrangler pages secret put AMAP_KEY
pnpm secret:resend      # = wrangler pages secret put RESEND_API_KEY
pnpm secret:turnstile   # = wrangler pages secret put TURNSTILE_SECRET
# any other secret: wrangler pages secret put <NAME>; locally, write .dev.vars
```

> Auth entrypoints (sign-in / register / resend activation / admin sign-in) are rate limited through the D1 `rate_limits` table. Re-run `pnpm db:init` (or `pnpm db:init:local`) once after upgrading an existing database.
> It is also worth adding a free rate-limiting rule for `/api/*` in the Cloudflare dashboard, as an outermost layer.

Other tunables are documented in `wrangler.toml.example`.

## Deploy

```bash
pnpm build        # tsc -b && tsc -p functions/tsconfig.json && vite build
pnpm deploy       # wrangler pages deploy dist
```

- D1 binding: fill in `database_id` in `wrangler.toml`, and configure the same binding in the Pages project under Settings → Functions → D1 bindings.
- Pages builds from Git cannot read the gitignored `wrangler.toml`; in that case the front end fetches public variables from `GET /api/config` at runtime, or you can set `AMAP_JS_KEY` / `AMAP_SECURITY_CODE` with `wrangler pages secret put`.
- Run `pnpm db:init` once after the first deploy to create the tables.

## Design notes

- **Local-first**: edits land in the browser first and reach D1 after a 1.4s debounce (`src/lib/sync.ts`). Writes carrying `baseUpdatedAt` get a 409 conflict instead of silently overwriting.
- **Same-origin defence**: a public repository means the endpoint shapes are public, so every defence lives server-side — no CORS headers, sign-in required for creation, global capacity and per-document size caps, salted PBKDF2-SHA256 passwords, session cookies carrying only a token digest, pinned upstream hosts (no SSRF), constant-time comparison, and id-format validation.
- **Coordinate systems**: storage is WGS84 throughout, while the AMap basemap and routes use GCJ02; conversion is centralised in `shared/coords.ts`.
- **Tap for a place**: lookups use AMap nearby search (v5 place/around), with the radius widening as you zoom out. Results are in GCJ02 (the basemap system) and nothing is written on lookup; only “Add to route” converts the point to WGS84 and stores it. Results for the same spot are cached for a day.
- **Driving throttle**: all driving requests pass one 3-per-second queue (`AMAP_DRIVE_QPS`) so the app does not trip its own upstream rate limit; codes 10004 / 10020 are retried with backoff and a different key.
- **Visibility**: new books default to private; older documents without the field are treated as public; private books never appear in public listings and return 404 to non-owners (existence is not leaked).

## Companion projects

- **WeChat mini program**: the `/mp` page introduces the companion mini program (gpx merge) — check the day's itinerary on your phone and tap a place to start navigation.

## Known limitations

- Routes are **driving only** (AMap driving planner); there is no walking, cycling or transit mode.
- Without `AMAP_KEY`, search degrades to the bundled gazetteer, no routes are drawn and the tap-for-a-place card reports an error; the app does not fall back to another map provider.
- Driving requests are capped at 3 per second (per isolate), so the first ordering of a very long trip may queue.
- One book is capped at `MAX_DOC_BYTES`; the whole site is capped at `MAX_BOOKS` books.
- AMap's open platform has no public “review text” API: the card shows the rating, review photos and a link, while the full reviews live on AMap.
- It runs on the Cloudflare free tier (Pages + a single D1 database).

## Contributing

- Before submitting, make sure `pnpm build` exits 0 (`tsc -b && tsc -p functions/tsconfig.json && vite build`); both `src/` and `functions/` must type-check. `pnpm lint` (oxlint) is optional.
- You do not need to start a dev server or a browser for that.
- Pull requests run the same checks automatically (`.github/workflows/pr.yml`: `pnpm lint` + `pnpm build`, Node 22 + pnpm 10); draft PRs are skipped until marked ready for review.
- Commit messages follow the existing style (Conventional Commits, e.g. `feat(sidebar): …`, `fix(search): …`).
- Respect this boundary: search and route planning work without signing in, while personal data (my books, creating / duplicating a book, saving edits, the cloud library) requires sign-in. The UI does not announce this — it is documented only.
- Any new server-side write path needs input validation and authorisation, and upstream hosts must be hard-coded.
- Bugs and requests go to [Issues](https://github.com/yangyang5214/lushu/issues); please include reproduction steps and, for map or route problems, whether `AMAP_KEY` is configured.

## License

[MIT](LICENSE) © 2026 lxa: use, copy, modify, merge, publish, distribute, sublicense and sell it freely, **including commercially**, as long as the copyright and permission notice stay in copies or substantial portions. The software comes with no warranty. The hosted `lushu.fittools.cc` instance is the author's own deployment and is not covered by this grant; third-party services such as AMap, Resend and Cloudflare have their own terms.

## Credits

[Cloudflare Pages / D1 / Turnstile](https://developers.cloudflare.com/) · [AMap Open Platform](https://lbs.amap.com/) · [React](https://react.dev/) · [Vite](https://vite.dev/) · [Zustand](https://zustand.docs.pmnd.rs/) · [Resend](https://resend.com/) · [oxlint](https://oxc.rs/)
