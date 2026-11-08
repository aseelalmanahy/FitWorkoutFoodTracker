# Beta hosting options (phase 8, for decision G2)

For a small invited beta: one Next.js instance, PostgreSQL, Caddy for HTTPS, encrypted offsite backups, lightweight monitoring. No microservices or Kubernetes. Nothing here is provisioned or bought.

**Sizing, measured on this PC (Windows):** about 0.8 GB for the app with both on-device readers loaded, and an export of a very large account peaked at about 700 MB (S-13). Linux figures come from G1. Plan on 4 GB RAM for the app host.

| | A. One server: app, PostgreSQL and Caddy together | B. App server plus a managed PostgreSQL |
|---|---|---|
| Monthly cost, indicative | A 4 GB VPS, about €4–10 at budget hosts (Hetzner's entry plans were about €4–5 in 2026 sources; CX22 may have been replaced by CX23), plus object storage for backups, a few € | The same VPS (a smaller one can do) plus a managed database from about $15 (DigitalOcean's smallest plan, 1 GB; a standby doubles it) |
| Backups | Ours: nightly `pg_dump`, encrypted, sent offsite, retention by our script; restore proven with `restore-check.cjs`'s method (G5) | The provider's daily backups and point-in-time recovery; we still prove a restore |
| Operational risk | Higher: PostgreSQL upgrades, disk, and backups are ours. One machine failing takes both down | Lower for the data: the provider patches and backs up. Two services to watch |
| Security | The database never leaves the machine's private network; one host to harden | TLS to the database required (the app refuses otherwise); access limited to the app server |
| Change needed here | Compose gains a PostgreSQL service on the internal network, a volume and a backup job (prepared after the decision) | None: the template already assumes an external database |
| Data residency | The host's region | Both providers' regions, which must match |

**Recommendation for the invited beta:** B if the extra cost is acceptable: the data is the one thing that can't be redone, and a managed database removes the riskiest operations from a one-person team. A if cost must be minimal, with the backup job and a monthly restore drill treated as mandatory. Either way: a monthly ceiling set with the provider (G2), one app instance, monitoring of `/api/health` with an alert to the owner (G6), and a rollback to the previous image tag (G7).

**Domain:** not bought yet. It's needed at C1 (a verified sending domain for password-reset email: SPF and DKIM records) and at G4 (HTTPS on a public name, from Caddy's certificate). A common domain costs roughly €10–20 a year; the owner chooses the name (decision 4).

Prices are from third-party 2026 summaries, not the providers' own pages; check them at decision time: [Hetzner, CX22 and CX23 (2026)](https://kimmo.suominen.com/stuff/cpc-2026-08.txt), [VPS benchmarks: CX22 deprecated](https://vpsbenchmarks.com/hosters/hetzner/plans/cx22), [DigitalOcean managed PostgreSQL pricing (2026)](https://infratally.com/articles/digitalocean-managed-postgres-deep-dive/), [managed PostgreSQL comparison (2026)](https://selfhost.dev/managed-postgresql-comparison-2026/).
