/**
 * ★ END-TO-END PROOF THAT A DEPLOYMENT'S EVIDENCE STORE WORKS — through the
 * public path (Vercel → tunnel → nginx → backend → R2), as real accounts. Run
 * from a workstation with Node ≥ 20.6, credentials in a file that is never
 * committed:
 *
 *   node --env-file=<path>/bo-smoke.env deploy/smoke-evidence.mjs
 *
 *   SMOKE_BASE_URL=https://opssystem.hoanglonglti.com/api   # or a local backend
 *   SMOKE_OFFICE_EMAIL=…   SMOKE_OFFICE_PASSWORD=…   # holds cost.import
 *   SMOKE_OTHER_EMAIL=…    SMOKE_OTHER_PASSWORD=…    # any OTHER settled account
 *   SMOKE_DRIVER_EMAIL=…   SMOKE_DRIVER_PASSWORD=…   # optional: driver checks
 *   SMOKE_ATTACH_VEHICLE_ID=… SMOKE_ATTACH_COST_ID=…  # optional: WRITES a fact
 *
 * Each run leaves one discarded image per door (rows are never deleted, and
 * content-addressed objects stay). The attach check is opt-in because it adds
 * evidence to a real cost's fuel transaction, which is append-only. Prints no
 * credential and no cookie.
 */
import { createHash, randomBytes } from 'node:crypto';
import { deflateSync } from 'node:zlib';

/**
 * ★ ONLY A KNOWN BACKEND. The script signs in with real credentials, so it
 * talks to the deployment or a local backend — picked from this list, never a
 * URL taken as typed (a typo must not send a password somewhere else).
 */
const BASES = ['https://opssystem.hoanglonglti.com/api', 'http://localhost:3000', 'http://localhost:3001'];
const BASE = (process.env.SMOKE_BASE_URL ?? BASES[0]).replace(/\/$/, '');
/** Every request goes through here: the backend is checked against the list right before it is called. */
const ORIGINS = BASES.map((base) => new URL(base).origin);
const send = (path, init) => {
  if (!BASES.includes(BASE)) throw new Error(`SMOKE_BASE_URL must be one of: ${BASES.join(', ')}`);
  const url = new URL(BASE + path);
  if (!ORIGINS.includes(url.origin)) throw new Error('refused a request outside the backend');
  return fetch(url, init);
};
const env = (name) => process.env[name] ?? '';
/** A path segment from the server or the operator: a uuid, encoded — never a way out of the route. */
const segment = (value) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(value))) throw new Error('an id is not a uuid');
  return encodeURIComponent(value);
};
const results = [];
const record = (status, check, detail = '') => {
  results.push(status);
  const line = detail ? `${status.padEnd(4)} ${check} — ${detail}` : `${status.padEnd(4)} ${check}`;
  console.log(line.replaceAll(/[\r\n]+/g, ' '));
};
const expect = (ok, check, detail) => record(ok ? 'PASS' : 'FAIL', check, detail);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

// ------------------------------------------------- a real, unique PNG ----
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
/** One 1×1 pixel, with a nonce so every run is new bytes (a new sha, a new object). */
const png = () =>
  Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0])),
    pngChunk('tEXt', Buffer.from(`Comment\0bo evidence smoke ${randomBytes(12).toString('hex')}`, 'latin1')),
    pngChunk('IDAT', deflateSync(Buffer.from([0, 0x2e, 0x7d, 0x32]))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);

// --------------------------------------------- a session, as a browser ----
const session = () => {
  let cookie = null;
  const call = async (method, path, body) => {
    const headers = {};
    if (cookie) headers.Cookie = cookie;
    if (method !== 'GET') headers['X-Requested-With'] = 'XMLHttpRequest';
    let payload;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const response = await send(path, { method, headers, body: payload, redirect: 'manual' });
    const set = response.headers.getSetCookie?.().find((line) => line.startsWith('bo_session='));
    if (set) cookie = set.split(';')[0].endsWith('=') ? null : set.split(';')[0];
    return response;
  };
  return {
    call,
    login: async (email, password) => (await call('POST', '/auth/login', { subject: email, password })).status,
    upload: (path, bytes) => {
      const form = new FormData();
      form.append('file', new Blob([bytes], { type: 'image/png' }), 'smoke.png');
      return call('POST', path, form);
    },
  };
};
const json = async (response) => (response.headers.get('content-type') ?? '').includes('json') ? response.json() : null;
const content = async (client, path) => {
  const response = await client.call('GET', path);
  const bytes = response.ok ? Buffer.from(await response.arrayBuffer()) : null;
  return { status: response.status, type: response.headers.get('content-type'), cache: response.headers.get('cache-control'), bytes };
};
const listed = async (client, path) => {
  const response = await client.call('GET', path);
  return response.ok ? ((await json(response)) ?? []).map((image) => image.id) : null;
};
const login = async (label, email, password) => {
  const client = session();
  const status = await client.login(email, password);
  if (status !== 200) throw new Error(`${label} could not sign in (${status}) — a settled account is needed`);
  return client;
};

// ---------------------------------------------------------------- run ----
try {
  for (const name of ['SMOKE_OFFICE_EMAIL', 'SMOKE_OFFICE_PASSWORD', 'SMOKE_OTHER_EMAIL', 'SMOKE_OTHER_PASSWORD']) {
    if (!env(name)) throw new Error(`${name} is not set`);
  }
  console.log(`Evidence store smoke test against ${BASE}`);
  const health = await send('/health');
  expect(health.ok, '1. backend answers /health', `${health.status} ${JSON.stringify((await json(health))?.checks ?? {})}`);

  const office = await login('the office account', env('SMOKE_OFFICE_EMAIL'), env('SMOKE_OFFICE_PASSWORD'));
  const other = await login('the other account', env('SMOKE_OTHER_EMAIL'), env('SMOKE_OTHER_PASSWORD'));

  // 2. Upload.
  const bytes = png();
  const staged = await office.upload('/fuel-evidence', bytes);
  const image = await json(staged);
  if (staged.status === 503) {
    expect(false, '2. upload', '503 SERVICE_UNAVAILABLE — the backend has NO object store (OBJECT_STORAGE_DRIVER is not r2 in the container)');
    throw new Error('stopped: nothing further can be proved without a store');
  }
  expect(staged.status === 201 && image?.sha256 === sha(bytes), '2. upload (POST /fuel-evidence)', `${staged.status}, sha256 ${image?.sha256 === sha(bytes) ? 'matches' : 'DIFFERS'}`);
  const id = segment(image.id);

  // 3. Metadata row.
  const mine = await (await office.call('GET', '/fuel-evidence/staged')).json();
  const row = mine.find((entry) => entry.id === image.id);
  expect(row?.sha256 === sha(bytes) && row.fuelTransactionId === null, '3. metadata row (GET /fuel-evidence/staged)', row ? `${row.mimeType}, ${row.byteSize} bytes, waiting` : 'NOT LISTED');

  // 4–5. The object, read back through the backend from the store.
  const read = await content(office, `/fuel-evidence/${id}/content`);
  expect(
    read.status === 200 && read.bytes && sha(read.bytes) === sha(bytes),
    '4. object in the store + 5. authenticated read (GET …/content)',
    `${read.status}, ${read.type}, cache-control "${read.cache}", bytes ${read.bytes && sha(read.bytes) === sha(bytes) ? 'identical' : 'DIFFER'}`,
  );
  expect(read.cache?.includes('no-store') && read.cache?.includes('private'), '   …never cached by a shared cache', read.cache ?? 'none');

  // 6–7. A new session — a refreshed browser — finds the waiting image and its preview.
  const again = await login('the office account (new session)', env('SMOKE_OFFICE_EMAIL'), env('SMOKE_OFFICE_PASSWORD'));
  const recovered = await listed(again, '/fuel-evidence/staged');
  const preview = await content(again, `/fuel-evidence/${id}/content`);
  expect(recovered?.includes(image.id), '6. recovery after refresh (new session lists it)');
  expect(preview.status === 200 && preview.bytes && sha(preview.bytes) === sha(bytes), '7. preview/content after refresh', String(preview.status));

  // 9. Isolation.
  const theirs = await content(other, `/fuel-evidence/${id}/content`);
  const theirList = await listed(other, '/fuel-evidence/staged');
  const theirDiscard = (await other.call('POST', `/fuel-evidence/${id}/discard`)).status;
  const anonymous = (await send(`/fuel-evidence/${id}/content`)).status;
  expect([403, 404].includes(theirs.status), '9. another account cannot read it', String(theirs.status));
  expect(!(theirList ?? []).includes(image.id), '   …nor list it', theirList === null ? 'no access to the list' : 'not in their list');
  expect([403, 404].includes(theirDiscard) && (await listed(office, '/fuel-evidence/staged'))?.includes(image.id), '   …nor discard it', String(theirDiscard));
  expect(anonymous === 401, '   …and no session reads nothing', String(anonymous));

  // 8. Discard.
  const discarded = (await office.call('POST', `/fuel-evidence/${id}/discard`)).status;
  const afterList = await listed(office, '/fuel-evidence/staged');
  const afterRead = (await content(office, `/fuel-evidence/${id}/content`)).status;
  const twice = (await office.call('POST', `/fuel-evidence/${id}/discard`)).status;
  const stillListed = afterList?.includes(image.id);
  expect(discarded === 204 && !stillListed && afterRead === 404 && twice === 404, '8. discard', `${discarded}; then listed: ${stillListed}, content ${afterRead}, again ${twice}`);

  // 10. Attached evidence stays readable (opt-in: writes to a real cost's fuel transaction).
  if (env('SMOKE_ATTACH_VEHICLE_ID') && env('SMOKE_ATTACH_COST_ID')) {
    const attachBytes = png();
    const toAttach = await json(await office.upload('/fuel-evidence', attachBytes));
    const attachId = segment(toAttach.id);
    const route = `/trip-vehicles/${segment(env('SMOKE_ATTACH_VEHICLE_ID'))}/costs/${segment(env('SMOKE_ATTACH_COST_ID'))}/fuel-transaction`;
    const attached = await office.call('POST', route, { evidence: [{ id: toAttach.id, type: 'receipt' }] });
    const attachedRead = await content(office, `/fuel-evidence/${attachId}/content`);
    const attachedOther = await content(other, `/fuel-evidence/${attachId}/content`);
    expect(
      attached.status === 201 && attachedRead.status === 200 && sha(attachedRead.bytes ?? Buffer.alloc(0)) === sha(attachBytes),
      '10. attached evidence remains readable',
      `attach ${attached.status}, read ${attachedRead.status}; another cost.import account ${attachedOther.status} (attached images are the team's; only a waiting one is the uploader's)`,
    );
  } else {
    record('SKIP', '10. attached evidence remains readable', 'set SMOKE_ATTACH_VEHICLE_ID + SMOKE_ATTACH_COST_ID of a designated test cost');
  }

  // The driver's door (#114).
  if (env('SMOKE_DRIVER_EMAIL')) {
    const driver = await login('the driver account', env('SMOKE_DRIVER_EMAIL'), env('SMOKE_DRIVER_PASSWORD'));
    const driverBytes = png();
    const up = await driver.upload('/driver/fuel-evidence', driverBytes);
    if (up.status === 404) {
      record('SKIP', 'driver door (POST /driver/fuel-evidence)', 'route not deployed — it arrives with #114');
    } else {
      const theirImage = await json(up);
      const theirId = segment(theirImage?.id);
      const driverList = await listed(driver, '/driver/fuel-evidence/staged');
      const driverRead = await content(driver, `/driver/fuel-evidence/${theirId}/content`);
      expect(up.status === 201 && driverList?.includes(theirImage.id) && driverRead.status === 200 && sha(driverRead.bytes ?? Buffer.alloc(0)) === sha(driverBytes),
        'driver door: upload, list, read own', `${up.status}, ${driverRead.status}`);
      expect((await office.call('GET', '/driver/fuel-evidence/staged')).status === 403, 'driver door closed to an office account');
      expect((await driver.call('GET', '/fuel-evidence/staged')).status === 403, 'office door closed to a driver');
      expect((await content(other, `/driver/fuel-evidence/${theirId}/content`)).status !== 200, 'another account cannot read the driver\'s image');
      expect((await driver.call('POST', `/driver/fuel-evidence/${theirId}/discard`)).status === 204, 'driver discards their own');
    }
  } else {
    record('SKIP', 'driver door', 'set SMOKE_DRIVER_EMAIL + SMOKE_DRIVER_PASSWORD');
  }
} catch (error) {
  record('FAIL', 'smoke test stopped', error.message);
}

const failed = results.filter((status) => status === 'FAIL').length;
console.log(failed ? `\nNOT VERIFIED — ${failed} check(s) failed.` : '\nVERIFIED — every check that ran passed.');
process.exit(failed ? 1 : 0);
