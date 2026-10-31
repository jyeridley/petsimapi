# PS99 Toolkit

A fast, dependency-free utility site for **Pet Simulator 99**, built on the official
[PS99 public API](https://github.com/BIG-Games-LLC/ps99-public-api-docs).

## Features

| Page | What it does | Endpoints |
| --- | --- | --- |
| **Prices** | Search every tradeable item with RAP and exist counts. Filter by category or variant (golden, rainbow, shiny), sort by value or rarity. | `/api/rap`, `/api/exists`, `/api/collection/*` (icons) |
| **Trade Calc** | Add items to each side of a trade (plus diamonds) and see a W / Fair / L verdict by RAP. Saved in your browser; copy a summary to share. | RAP data |
| **Players** | Search public profiles. View stats, currencies, mastery, inventory value, equipped pets, trades, booth and mail history, item index. | `/v1/players/*` |
| **Clans** | Top clans by points or diamonds, clan lookup (roster, medals, contributions), active clan battle standings. | `/api/clans*`, `/api/clan/:name`, `/api/activeClanBattle`, `/v1/clans/battles/:id` |
| **Leagues** | Any season's leaderboard with name search, top contributors, placement rewards, and league detail. | `/v1/leagues/*` |
| **Leaderboards** | Live and final standings for in-game event boards, with reward tiers and player lookup by user ID. | `/v1/leaderboards/*` |
| **Updates** | Every game version, what it added or changed, with field-by-field diffs. | `/v1/releases/*` |
| **Game Data** | Browse raw config collections (Pets, Eggs, Zones, …) with search and JSON view. | `/api/collections`, `/api/collection/:name` |

Light and dark themes, works on mobile, deep-linkable URLs (e.g. `#/player/chickenputty`, `#/clan/CAT`).

## Running it

It's a static site: `index.html`, `styles.css`, `app.js`. No build step.

```bash
python3 -m http.server 8000
```

Then open <http://localhost:8000>. You can also just open `index.html` directly.

### Hosting on GitHub Pages

In the repo go to **Settings → Pages**, set **Source** to *Deploy from a branch*, then pick `main` and `/ (root)`.

## Rate limits

The public API allows about 100 requests per minute per IP. The site caches responses in memory,
merges duplicate in-flight requests, and caps itself at 90 requests per minute. RAP data is cached for 4 hours.

## Disclaimer

Unofficial fan project. Not affiliated with BIG Games. Data © BIG Games, used under the API's
[terms](https://github.com/BIG-Games-LLC/ps99-public-api-docs/blob/main/TERMS.md).
