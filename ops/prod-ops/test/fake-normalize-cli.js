// Stand-in for the trip capability's normalization CLI, installed at the real
// path inside the e2e test's fake backend container. Same argv contract, same
// JSON shape (README.md, "Contract with the trip capability"). It writes nothing
// but a record of its calls, so the test can prove when it was - and was NOT -
// called. State lives in /app/e2e, a root-only directory the test creates, not /tmp.
// `outcomes` there steers it: {"<id>": "<OUTCOME>"} or {"mode": "fail" | "garbage" | "drop-last"}.
const fs = require('node:fs');

const STATE = '/app/e2e';
const argv = process.argv.slice(2);
fs.appendFileSync(`${STATE}/cli-calls`, `${JSON.stringify(argv)}\n`);
const value = (flag) => argv[argv.indexOf(flag) + 1];
const steering = `${STATE}/outcomes`;
const script = fs.existsSync(steering) ? JSON.parse(fs.readFileSync(steering, 'utf8')) : {};

if (script.mode === 'fail') {
  console.error('simulated failure after an unknown number of writes');
  process.exit(1);
}
if (script.mode === 'garbage') {
  console.log('this is not the contract');
  process.exit(0);
}
let ids = value('--ids').split(',');
if (script.mode === 'drop-last') ids = ids.slice(0, -1);
const results = ids.map((id) => ({ id, outcome: script[id] ?? 'NORMALIZED' }));
const summary = {};
for (const { outcome } of results) summary[outcome] = (summary[outcome] ?? 0) + 1;
console.log(JSON.stringify({ mode: 'apply', by: value('--by'), summary, results }, null, 2));
