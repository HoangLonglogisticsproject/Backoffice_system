import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { FilesystemObjectStorage } from './filesystem-object-storage';

const drain = async (stream: Readable): Promise<Buffer> => {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
};

describe('FilesystemObjectStorage', () => {
  let root: string;
  let storage: FilesystemObjectStorage;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'object-storage-'));
    storage = new FilesystemObjectStorage(root);
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('stores bytes under the key and streams them back', async () => {
    await storage.put('fuel-evidence/abc123', Buffer.from('jpeg bytes'), 'image/jpeg');
    expect((await drain(await storage.get('fuel-evidence/abc123'))).toString()).toBe('jpeg bytes');
    expect(await readFile(join(root, 'fuel-evidence', 'abc123'), 'utf8')).toBe('jpeg bytes');
  });

  it('writes the same key twice as one file, leaving no temporary behind', async () => {
    await storage.put('fuel-evidence/same', Buffer.from('x'), 'image/png');
    await storage.put('fuel-evidence/same', Buffer.from('x'), 'image/png');
    expect(await readdir(join(root, 'fuel-evidence'))).toEqual(['same']);
  });

  it('rejects a missing object before any stream starts', async () => {
    await expect(storage.get('fuel-evidence/missing')).rejects.toThrow();
  });

  it.each(['../escape', '/absolute', 'fuel-evidence/../../x', 'UPPER/case', 'dot.ted', ''])(
    'refuses the unsafe key %p — no path outside the root',
    async (key) => {
      await expect(storage.put(key, Buffer.from('x'), 'image/png')).rejects.toThrow(/unsafe object storage key/);
      await expect(storage.get(key)).rejects.toThrow(/unsafe object storage key/);
    },
  );
});
