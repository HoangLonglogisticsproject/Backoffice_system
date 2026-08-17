/**
 * Đồ thị phụ thuộc cấp thư mục: phát hiện vòng và chiều đi ngược.
 *
 * Bổ sung cho check-architecture.sh — grep bắt được "ai import cái gì",
 * script này bắt được thứ grep không thấy: một cạnh HỢP LỆ khi nhìn riêng lẻ
 * nhưng khép thành vòng khi nhìn cả đồ thị.
 *
 * Không thêm dependency: chỉ dùng fs của Node.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, normalize, sep } from 'node:path';

const FOUNDATION = ['components', 'services', 'store', 'types', 'utils', 'constants'];
const ROOTS = [...FOUNDATION, 'app', 'features'];
const ALIAS = {
  '@bo/components': 'components', '@bo/services': 'services', '@bo/store': 'store',
  '@bo/types': 'types', '@bo/utils': 'utils', '@bo/constants': 'constants',
};

/** Chiều được phép. Thiếu trong bảng = cấm. */
const ALLOWED = {
  app: ROOTS,
  features: FOUNDATION,
  components: ['utils', 'constants', 'types'],
  services: ['types', 'store', 'utils', 'constants', 'components'],
  store: ['types', 'utils', 'constants'],
  types: [],
  utils: [],
  constants: [],
};

const walk = (d) =>
  readdirSync(d, { withFileTypes: true }).flatMap((e) => {
    const p = join(d, e.name);
    return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
  });

const edges = new Map();
for (const root of ROOTS) {
  if (!existsSync(root)) continue;
  for (const file of walk(root)) {
    for (const [, spec] of readFileSync(file, 'utf8').matchAll(/from '([^']+)'/g)) {
      let dst = ALIAS[spec];
      if (!dst && spec.startsWith('.')) dst = normalize(join(dirname(file), spec)).split(sep)[0];
      if (!dst || !ROOTS.includes(dst) || dst === root) continue;
      const key = `${root} -> ${dst}`;
      if (!edges.has(key)) edges.set(key, []);
      edges.get(key).push(`${file}  →  ${spec}`);
    }
  }
}

let failed = false;
const fail = (title, lines) => {
  failed = true;
  console.log(`\n\x1b[31m✘ ${title}\x1b[0m`);
  lines.forEach((l) => console.log(`    ${l}`));
};
const pass = (title) => console.log(`\x1b[32m✔\x1b[0m ${title}`);

// --- 1. chiều đi có được phép không ------------------------------------------
const illegal = [];
for (const [key, where] of edges) {
  const [from, to] = key.split(' -> ');
  if (!(ALLOWED[from] ?? []).includes(to)) illegal.push(`${key}   (${where.length}×)\n      ${where[0]}`);
}
illegal.length ? fail('I1  chiều phụ thuộc bị cấm', illegal) : pass('I1  mọi chiều phụ thuộc đều hợp lệ');

// --- 2. nền tảng không bao giờ với lên app/features --------------------------
// Đây chính là bài test portability: 6 thư mục này bê sang dự án khác được.
const leaks = [];
for (const [key, where] of edges) {
  const [from, to] = key.split(' -> ');
  if (FOUNDATION.includes(from) && (to === 'app' || to === 'features')) {
    leaks.push(`${key}\n      ${where[0]}`);
  }
}
leaks.length
  ? fail('I2  nền tảng rò rỉ sang app/features', leaks)
  : pass(`I2  portability: ${FOUNDATION.join(', ')} ↛ app · features`);

// --- 3. vòng phụ thuộc -------------------------------------------------------
const graph = {};
for (const key of edges.keys()) {
  const [a, b] = key.split(' -> ');
  (graph[a] ??= []).push(b);
}
const cycles = new Set();
const dfs = (node, path) => {
  for (const next of graph[node] ?? []) {
    if (path.includes(next)) cycles.add([...path.slice(path.indexOf(next)), next].join(' -> '));
    else dfs(next, [...path, next]);
  }
};
Object.keys(graph).forEach((n) => dfs(n, [n]));
cycles.size ? fail('I3  vòng phụ thuộc', [...cycles]) : pass('I3  không có vòng phụ thuộc');

console.log();
console.log('\x1b[2m    đồ thị:\x1b[0m');
[...edges.entries()].sort().forEach(([k, w]) => console.log(`\x1b[2m      ${k.padEnd(26)} ${w.length}×\x1b[0m`));
console.log();
console.log(failed ? '\x1b[31mCó vi phạm — xem ở trên.\x1b[0m' : '\x1b[32mĐồ thị phụ thuộc sạch.\x1b[0m');
process.exit(failed ? 1 : 0);
