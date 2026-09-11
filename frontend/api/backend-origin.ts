/**
 * ★ THE PRODUCTION BACKEND ORIGIN, AND THE ONLY PLACE IT IS WRITTEN DOWN.
 *
 * This value used to be a Vercel Project Environment Variable, which meant two
 * systems each held their own copy of it: the Vercel project decided what
 * production actually called, and a GitHub Environment variable decided what
 * the release gate checked before promoting the frontend. Nothing compared
 * them. A release could therefore verify one origin, promote a frontend
 * pointing at another, and report success — the gate would be measuring a host
 * that no user ever reaches.
 *
 * Committing it removes the second copy rather than trying to keep two in
 * agreement. `.github/workflows/ci.yml` reads THIS FILE, and the deployed edge
 * function imports THIS FILE, so "the origin the gate verified" and "the origin
 * production calls" are the same string by construction, not by convention.
 *
 * ⚠ THE VERCEL DASHBOARD VARIABLE IS NOW INERT. `[...path].ts` no longer reads
 * `process.env.BACKEND_ORIGIN` at all. Delete it from the project rather than
 * leaving it there to be edited by somebody who reasonably expects it to work —
 * a setting that looks live and changes nothing is worse than no setting.
 *
 * ★ AND THE ORIGINAL ARGUMENT FOR AN ENVIRONMENT VARIABLE HAS EXPIRED. It was
 * written when this pointed at a quick tunnel whose hostname changed on every
 * restart, and "a URL in git that moves every restart is a redeploy waiting to
 * be forgotten" was correct at the time. It is now a stable domain with a
 * certificate that renews itself. A value that changes roughly never belongs in
 * review, not in a dashboard where a change leaves no trace.
 *
 * ★ CHANGING IT IS A COMMIT, ON PURPOSE. Failing over to the Cloudflare Tunnel
 * means editing this line and shipping it. That is slower than a dashboard
 * toggle and it is the trade being made deliberately: the failover becomes
 * reviewable, attributable and visible in `git log`, instead of a change nobody
 * can find afterwards. deploy/README.md carries the procedure.
 *
 * ⚠ MUST BE `https://`. `resolveOrigin` in `[...path].ts` refuses anything else
 * for a non-loopback host, and the release workflow refuses it again before it
 * deploys. Two checks that can disagree beat one that is trusted.
 */
export const PRODUCTION_BACKEND_ORIGIN = 'https://bo-api.hoanglonglti.com';
