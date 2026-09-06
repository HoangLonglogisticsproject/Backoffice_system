const fs = require('fs');
const path = require('path');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx?$/.test(e.name) && !/\.spec\./.test(e.name)) files.push(p);
  }
})('src');

const N = 10; // Sonar's default minimum duplicated block for JS/TS
const norm = (l) => l.trim().replace(/\s+/g, ' ');
const blocks = new Map();

for (const f of files) {
  const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/).map(norm);
  for (let i = 0; i + N <= lines.length; i++) {
    const win = lines.slice(i, i + N);
    if (win.filter((l) => l.length > 0).length < N) continue;
    const key = win.join('');
    if (!blocks.has(key)) blocks.set(key, []);
    blocks.get(key).push(f + ':' + (i + 1));
  }
}

const target = path.join('src', 'pages', 'organization', 'EmployeeDetailPage.tsx');
const hits = [...blocks.entries()].filter(
  ([, at]) => at.length > 1 && at.some((a) => a.startsWith(target)),
);

console.log('duplicate ' + N + '-line blocks touching EmployeeDetailPage: ' + hits.length);

const seen = new Set();
for (const [key, at] of hits) {
  const sig = at.join('|');
  if (seen.has(sig)) continue;
  seen.add(sig);
  console.log('\n--- ' + at.join('   &   '));
  for (const line of key.split('').slice(0, 5)) console.log('    ' + line);
}
