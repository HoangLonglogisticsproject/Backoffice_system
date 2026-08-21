# Production launch checklist

Items that **cannot be enforced by application code or caught by CI**, because they live in
the deployment rather than in this repository. Each one is either configuration on the VPS,
in Cloudflare, or in PostgreSQL.

Confirmed topology:

```
client  →  Cloudflare  →  VPS  →  backend (1 replica)  →  PostgreSQL
```

Whether nginx sits on the VPS between Cloudflare and the backend is **not recorded in this
repository**. Item 2 is written so that it is correct either way, and item 1 is where you
write down which it actually is.

---

## 1. Record the real request chain

Before setting anything, establish what the chain is. Guessing here is what produced the
finding in audit §22.3.

- [ ] Write down the actual path, one of:
  - `Cloudflare → backend` (Node listens on the public interface, TLS at Cloudflare)
  - `Cloudflare → nginx → backend` (nginx on the VPS, backend on loopback)
  - `Cloudflare Tunnel → backend` (no public listener at all)
- [ ] Note the address the backend sees as its **immediate peer** in that path. That address
      is what item 2 must trust — Cloudflare's edge for a direct chain, `127.0.0.1` for
      nginx on the same host.

> Verify rather than assume: log `req.ip` next to `req.headers['x-forwarded-for']` on one
> staging request from a known address, confirm `req.ip` equals that address, then remove
> the logging. If they differ, item 2 is wrong.

## 2. `TRUSTED_PROXIES`

The login throttle keys on `req.ip`. This setting decides whether that value is a fact or a
caller's suggestion.

- [ ] Set `TRUSTED_PROXIES` to the addresses from item 1:
  - Cloudflare's IPv4 **and** IPv6 ranges, taken from <https://www.cloudflare.com/ips/> —
    they change, so take them from there rather than from any file in this repo
  - plus `loopback` if nginx is on the same host
- [ ] Leave it **empty** anywhere nothing is in front (development, a directly-reachable
      staging box). Empty means the header is ignored, which is the safe reading.
- [ ] Confirm the app **starts**. An entry that is not an IP, CIDR or preset is refused at
      boot on purpose: a typo would silently trust nobody, collapse every caller onto the
      proxy's address, and turn the per-IP throttle into a global one.
- [ ] Re-check after any Cloudflare range change.

## 3. Restrict the origin — **required, and not optional**

`TRUSTED_PROXIES` decides *whom to believe*. It cannot stop anyone **reaching** the origin.
Both halves are needed, and neither is sufficient alone:

| | Origin reachable directly | Origin restricted to Cloudflare |
|---|---|---|
| `TRUSTED_PROXIES` empty | throttle is global → lockout | throttle is global → lockout |
| `TRUSTED_PROXIES` set | **throttle void** — attacker forges the header | ✅ correct |

Pick **one** of these. They are listed strongest first; this repository cannot verify any
of them, and none of them is invented here — each is a standard, documented product feature.

- [ ] **Cloudflare Tunnel** (`cloudflared`) — the origin opens an outbound connection and
      has **no public listener at all**. Nothing to firewall, nothing to bypass, and it
      survives the VPS address becoming known. Strongest option, and the one to prefer for
      a single VPS.
- [ ] **Host firewall allowlist** — `ufw` / `nftables` permitting `443` only from
      Cloudflare's published ranges, default-deny otherwise. Requires re-applying whenever
      those ranges change; automate it or it rots.
- [ ] **Authenticated Origin Pulls** (Cloudflare mTLS) — the origin requires a client
      certificate that only Cloudflare holds. Combines well with the firewall and does not
      depend on IP ranges staying stable.

And regardless of which:

- [ ] If nginx is in front, bind the backend to `127.0.0.1` so it has no externally
      reachable socket of its own.
- [ ] Confirm the bypass is actually closed: from a host outside Cloudflare, request the
      VPS address directly and confirm the connection is refused or the request rejected.
      **This is the test that matters** — everything above is a means to it.

## 4. PostgreSQL principals

The application must not run as a superuser. See audit §21.2 and
`backend/scripts/provision-db-roles.sql`.

- [ ] Run `provision-db-roles.sql` once, as a DBA, with passwords supplied from the
      environment — never from a file in the repo.
- [ ] Migrate as `bo_migrator`: `DATABASE_URL=postgres://bo_migrator:…@…/… npm run migrate`
- [ ] Then the two grants that need tables migrations create:
      `GRANT SELECT, DELETE ON sessions TO bo_ops;`
      `REVOKE ALL ON schema_migrations FROM bo_app;`
- [ ] Point the application's `DATABASE_URL` at **`bo_app`**, and nothing else at
      `bo_migrator`.
- [ ] Confirm `SELECT rolsuper, rolcreatedb, rolcreaterole, rolbypassrls FROM pg_roles
      WHERE rolname LIKE 'bo\_%'` returns false in every column.
- [ ] Confirm PostgreSQL is not reachable from outside the VPS. `docker-compose.yml`
      publishes `5432:5432`; that file is for development.

## 5. Session sweep

Owned by ops. `bo_ops` exists for exactly this and can do nothing else.

- [ ] Install a daily off-peak cron running, as `bo_ops`:
      ```sql
      DELETE FROM sessions
       WHERE expires_at < now() - interval '30 days'
          OR (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days');
      ```
- [ ] Alert if it has not run for 7 days, or if `SELECT count(*) FROM sessions` passes a
      threshold set from the user count.
- [ ] If it stops, nothing becomes unsafe — expired and revoked sessions are already
      refused on every request. The cost is disk and index size.

## 6. Application environment

- [ ] `NODE_ENV=production` — this is what makes the session cookie `Secure`.
- [ ] `CORS_ORIGINS` — the real frontend origin, or **empty** if the client is served from
      the same origin. Never `*`; the schema refuses it.
- [ ] `ALLOWED_EMAIL_DOMAINS` — **leave it unset** for Hoàng Long: the schema defaults to
      `hoanglongti.com`, so the company policy holds without anyone remembering a variable.
      Set it only to point a different deployment at a different domain. Setting it to an
      EXPLICIT empty value means no restriction at all — see
      `docs/backend/company-email-policy.md`.
      Not a mailbox check: nothing verifies the address receives mail.
- [ ] Confirm no secret is passed on a command line: the bootstrap CLI reads
      `BOOTSTRAP_PASSWORD` from the environment or a prompt, never `argv`.

## 7. TLS and browser headers

The application deliberately does not set HSTS or CSP — see `backend/src/main.ts`.

- [ ] TLS terminated at Cloudflare, with the origin leg encrypted too (Full (strict), not
      Flexible).
- [ ] **HSTS** set at the edge, not by the app.
- [ ] **CSP** set wherever the frontend is served. This API serves no scripts and cannot
      know their sources.
- [ ] Confirm `X-Content-Type-Options`, `X-Frame-Options` and `Referrer-Policy` survive the
      proxy — the app sets all three, and a misconfigured proxy can drop them.

## 8. Before scaling out

The login throttle is process-local **by design**, because the topology has one replica.

- [ ] **Blocking:** before a second backend replica serves traffic, move the throttle to a
      shared atomic store, or move rate limiting to Cloudflare. At N replicas an attacker
      gets N times the budget.
- [ ] Nothing to do while there is one replica.

## 9. Assurance

- [ ] Commission an **independent penetration test**. Automated regression (543 tests) and
      internal adversarial testing (72 cases) have both been done; neither substitutes for
      an outside party. See audit §22.5.
- [ ] Give it the scope this repository cannot cover: Cloudflare configuration and the
      origin bypass from item 3, TLS, VPS and SSH hardening, PostgreSQL reachability,
      backups, and `TRUSTED_PROXIES` **as deployed** rather than as documented.
- [ ] Backup and restore: verify a restore actually works, not just that a backup exists.
