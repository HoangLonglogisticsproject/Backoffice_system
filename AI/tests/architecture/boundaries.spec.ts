import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * The boundary, pinned from inside Jest as well as by scripts/check-boundaries.sh.
 *
 * Two checkers on purpose: the script runs in CI and on the command line; this
 * spec runs wherever `npm test` runs, including an editor. Both read the same
 * tree, so neither can be quietly disabled without the other noticing.
 */
const ROOT = join(__dirname, '..', '..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist') continue;
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

const importsOf = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/gm)].map((m) => m[1] as string);

describe('the /AI boundary', () => {
  const sources = [...walk(join(ROOT, 'src')), ...walk(join(ROOT, 'tests'))];

  it('never imports backend/src or frontend/src', () => {
    const offenders = sources.filter((file) =>
      importsOf(file).some((spec) => /(^|\/)(backend|frontend)\//.test(spec)),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('keeps every domain/ file free of the framework, the driver and the outer layers', () => {
    const domain = sources.filter((f) => /[\\/]core[\\/][^\\/]+[\\/]domain[\\/]/.test(f) && !f.endsWith('.spec.ts'));
    expect(domain.length).toBeGreaterThan(0);

    const offenders = domain.filter((file) =>
      importsOf(file).some((spec) => /^(@nestjs|pg|express)/.test(spec) || /\/(infrastructure|persistence|api)\//.test(spec)),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('references no public.* table from runtime source or migrations', () => {
    const runtime = [
      ...walk(join(ROOT, 'src')).filter((f) => !f.endsWith('.spec.ts')),
      ...readdirSync(join(ROOT, 'migrations')).filter((f) => f.endsWith('.sql')).map((f) => join(ROOT, 'migrations', f)),
    ];
    const offenders = runtime.filter((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => !/^\s*(--|\/\/|\*|\/\*)/.test(line))
        .some((line) => /\bpublic\./i.test(line)),
    );
    expect(offenders.map((f) => relative(ROOT, f))).toEqual([]);
  });

  it('declares none of the dependencies Phase 1 forbids', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    const declared = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const forbidden = /^(langchain|@langchain\/|llamaindex|openai|@anthropic-ai\/|@google\/generative-ai|pgvector|@qdrant\/|weaviate|@pinecone-database\/|ioredis|redis|bullmq|bull$|@nestjs\/bull|kafkajs|amqplib|node-cron|cron$|@nestjs\/schedule)/;
    expect(declared.filter((name) => forbidden.test(name))).toEqual([]);
  });
});
