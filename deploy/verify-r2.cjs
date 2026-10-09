/**
 * ★ PROVES THE ENV FILE'S R2 SETTINGS BEFORE THE BACKEND RESTARTS ONTO THEM —
 * run as root on the VPS as a one-off of the backend service, so it sees exactly
 * the environment Compose gives the container (deploy/README.md, "Fuel
 * evidence storage", step 3):
 *
 *   APP_VERSION=<running tag> docker compose --env-file /etc/hoanglong-bo/staging.env \
 *     run --rm --no-deps -T backend node - < verify-r2.cjs
 *
 * Uses the app's OWN validation and R2 adapter — the exact code that will
 * serve the images. Writes one small probe object under `probe/`, reads it
 * back, and checks the S3 endpoint will not hand it to an anonymous caller.
 * Prints no credential; a bad setting is named by its key, never its value.
 *
 * Why it matters: once the compose file passes these values through, a
 * malformed one refuses the backend at boot — and the release's rollback
 * would meet the same env file. Prove it here first.
 */
const { createHash, randomBytes } = require('node:crypto');
// `node -` resolves from the working directory — the image's /app.
const { validateEnv } = require('./dist/config/env.schema');
const { R2ObjectStorage } = require('./dist/infrastructure/object-storage/r2-object-storage');

(async () => {
  // The env file has no DATABASE_URL (compose builds it); this check needs none.
  const env = validateEnv({ DATABASE_URL: 'postgres://probe@localhost/probe', ...process.env, NODE_ENV: 'production' });
  if (env.OBJECT_STORAGE_DRIVER !== 'r2') throw new Error(`OBJECT_STORAGE_DRIVER is "${env.OBJECT_STORAGE_DRIVER}", not "r2"`);
  const settings = {
    accountId: env.R2_ACCOUNT_ID,
    bucket: env.R2_BUCKET,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
  };
  const store = new R2ObjectStorage(settings);
  const body = Buffer.from(`hoanglong-bo r2 probe ${new Date().toISOString()} ${randomBytes(8).toString('hex')}`);
  const key = `probe/${createHash('sha256').update(body).digest('hex')}`;

  await store.put(key, body, 'text/plain');
  const chunks = [];
  for await (const chunk of await store.get(key)) chunks.push(chunk);
  if (!Buffer.concat(chunks).equals(body)) throw new Error('the object read back differs from the one written');

  const anonymous = await fetch(`https://${settings.accountId}.r2.cloudflarestorage.com/${settings.bucket}/${key}`);
  if (anonymous.ok) throw new Error('the S3 endpoint served the object to an anonymous caller');

  console.log(`R2 OK — settings valid; bucket "${settings.bucket}": write + read-back by the app's adapter; anonymous read refused (${anonymous.status}).`);
  console.log('Still confirm in the Cloudflare dashboard: R2.dev public access DISABLED, no custom domain on this bucket.');
})().catch((error) => {
  console.error(`R2 NOT READY — ${error.message}`);
  process.exit(1);
});
