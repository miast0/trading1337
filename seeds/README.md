# Seeds

Seeds populate the database directly. `init_seed.json` contains 50 users. Copy [seed-template.json](seed-template.json) to create your own.

JSON contains `name` and `users`. Keep each user's data inside their entry. Importing replaces listed users' data and keeps other accounts. Omitted lists are empty.

## JSON fields

The template lists the profile fields. Exports store password hashes instead of readable passwords.

Avatar colours use the first six characters of the username's MD5 hash.

Optional lists under each user:

| List | Fields per entry |
| --- | --- |
| `holdings` | `asset`, `quantity`, `averageCostCents` |
| `watchlist` | `asset`, `createdAt` |
| `followers`, `follows` | `username`, `createdAt` |
| `trades` | `key`, `asset`, `side` (`buy` or `sell`), `quantity`, `priceCents`, `totalCents`, `createdAt`; optional `copiedFrom` trade key |
| `posts` | `key`, `createdAt`, `body`; optional `asset` or `trade` key. A trade post can omit `body`. |
| `transfers` | `to` for outgoing or `from` for incoming, `asset`, `quantity`, `createdAt` |

Posts/trades accept `likes` (`username`, `createdAt`) and `comments` (`username`, `body`, `createdAt`). Referenced users must exist. Trade and post keys must be unique.

User totals: `followerCount`, `followingCount`, `tradeCount`, `postCount`. Post/trade totals: `likeCount`, `commentCount`, plus `copyCount` on trades. Totals include listed records; higher totals don't create extra records. Omit to count supplied records.

Use ISO dates (`2026-10-20T12:00:00.000Z`), asset symbols (`BTC`) and integer euro cents (`cashCents: 10000` = €100). Transfers are crypto only.

## Scripts

Run from the project directory with Docker running:

- `./scripts/seed.sh seeds/init_seed.json` — import a seed.
- `./scripts/export-seed.sh snapshot` — export current user data to `seeds/snapshot.json`.
- `./scripts/reset.sh` — delete all users and activity after confirmation; keep markets and the service running.
