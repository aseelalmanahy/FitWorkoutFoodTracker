# Beta hosting options (phase 8, for decision G2)

For a small invited beta: one Next.js instance, PostgreSQL, Caddy for HTTPS, encrypted offsite backups, lightweight monitoring. No microservices or Kubernetes. **Nothing here is provisioned or bought, and nothing here is approved.**

**Sizing, measured on this PC (Windows):** about 0.8 GB for the app with both on-device readers loaded, and an export of a very large account peaked at about 700 MB (S-13). Linux figures come from G1, which hasn't run yet. Plan on 4 GB RAM for the app host.

## Prices, checked 2026-11-08 on the providers' own pages

Read through a page-summarising tool, so re-check each figure in the provider's console before ordering. No page showed a "last updated" date.

| Item | Price | Source |
|---|---|---|
| Hetzner Cloud CX23 (2 vCPU, 4 GB, 40 GB NVMe), EU | €5.99/month, excl. VAT. The page marked plans "currently unavailable", which the overview page contradicts: check availability in the console | hetzner.com/cloud/cost-optimized |
| Hetzner Cloud, US locations | **Not verified.** The locations are listed, but no US price was shown | hetzner.com/cloud |
| Hetzner public IPv4 | €0.50/month | docs.hetzner.com/cloud/servers/overview |
| Hetzner server backups add-on | "from €1.198/month" (no percentage given) | hetzner.com/cloud/cost-optimized |
| Hetzner Object Storage | €6.49/month, including 1 TB of storage and 1 TB of egress | hetzner.com/storage/object-storage |
| DigitalOcean Basic Droplet, 4 GB | $24.00/month | digitalocean.com/pricing/droplets |
| DigitalOcean Managed PostgreSQL, smallest (1 GB, 1 vCPU, 10 GB) | $15.15/month ($15.00 in the docs). Neither page says whether daily backups and point-in-time recovery are included | digitalocean.com/pricing/managed-databases |
| DigitalOcean change | From 2026-11-30 for all accounts, new Standard clusters can't use plans above 4 GB or add standby nodes | DigitalOcean docs |
| Resend, free tier | 100 emails/day, 3,000/month, 3 domains. **Sending requires a verified domain you own** | resend.com/pricing, resend.com/docs |
| Resend Pro | $20/month, 50,000 emails/month | resend.com/pricing |
| .com domain (Porkbun) | $11.81/year, registration and renewal | porkbun.com/products/domains |

## The two options

| | A. One server: app, PostgreSQL and Caddy together | B. App server plus a managed PostgreSQL |
|---|---|---|
| Monthly cost, at today's prices | Hetzner CX23 €5.99 + IPv4 €0.50 + server backups ~€1.20 + Object Storage €6.49 for offsite dumps ≈ **€14.2/month excl. VAT** | DigitalOcean Droplet $24 + Managed PostgreSQL $15.15 ≈ **$39/month**. A standby, or a database at a different provider, costs more |
| Backups | Ours: a nightly encrypted `pg_dump` to object storage, plus Hetzner's server snapshots as a second copy. Restore proven with `restore-check.cjs`'s method (G5) | The provider's daily backups (point-in-time recovery terms unverified). We still prove a restore |
| Migration guard | **Known to work.** We create the roles from `deploy/database-roles.sql`, so the migrator owns the schema and no other role can write the migration history | **Unverified.** The guard refuses if any role other than the migrator can write the migration history, including through `pg_write_all_data`. Whether the provider's admin role allows a passing setup has to be tested before choosing B |
| Operational risk | Higher: PostgreSQL updates, disk and backups are ours, and one machine failing takes both down | Lower for the data: the provider patches and backs up. Two services to watch |
| Security | The database never leaves the machine, and 5432 is never exposed. One host to harden | TLS to the database required (the app refuses otherwise), and access limited to the app server |
| Change needed here | Compose gains a PostgreSQL service on the internal network, a volume and a backup job (prepared after the decision) | None: the template already assumes an external database |
| Data residency | The chosen Hetzner region | Both services' regions, which must match |

## Recommendation: A, on Hetzner, for the invited beta

This changes the earlier recommendation, which was B if the cost was acceptable. The reasons:

1. **A is what the release tooling is proven against.** The migrate guard and the role template have run live against roles we create. With B, the guard's compatibility with the provider's admin roles is an open question that could block G3.
2. **It costs about a third as much:** roughly €14 a month against $39, for a beta of a few invited people.
3. **It's smaller to attack.** The database is never reachable from the network.

A's weakness is that recovery is ours. So A is recommended only on three mandatory conditions:

- a nightly, encrypted, offsite dump;
- a monthly restore drill with `restore-check.cjs`;
- `/api/health` monitoring with an alert to the owner (G6).

Move to B, or another managed database, before opening the beta beyond invited testers, or if the monthly drill can't be kept up.

**Expected total for the beta:** about **€14/month excl. VAT**, plus about **$12/year** for a domain. Resend's free tier is enough for an invited beta.

## Proposed operating targets (PROPOSED, not approved: the owner decides at G2)

| Target | Proposal | Why |
|---|---|---|
| Recovery point (RPO) | 24 hours | Nightly dump. A day of logging is the most a tester could lose |
| Recovery time (RTO) | 4 hours | Restore the latest dump to a fresh server, following the runbook |
| Backup retention | 14 days of nightly dumps, and 7 days of server snapshots | Decision 12. It sets how long a deleted account can remain in backups, which the privacy notice must state (NOTICE-B) |
| Backup encryption | Encrypted before upload to a public key. The private key is held by the owner (a password manager plus a sealed offline copy), never on the server, so a compromised server can't read old backups | A lost key means lost backups, and a key kept on the server makes the backups only as safe as the server |
| Restoring after an account deletion | Re-delete accounts that were deleted after the backup was taken (S-14) | So a restore never brings a deleted account back |
| Monthly spending ceiling | €25, set with the provider | An alert long before anything costly |

## Domain

Not bought yet. It's needed at C1 (a verified sending domain for password-reset email, with SPF and DKIM records) and at G4 (HTTPS on a public name, from Caddy's certificate). The owner chooses the name (decision 4). It's needed only when C1 starts.

## Secrets (proposed)

Production secrets live only on the host, in an environment file readable by root alone and passed to Compose. They're never in the image or in Git. The app validates its required settings at startup (`src/lib/server/production-config.ts`), and G1 checks that no development secret enters the image.
