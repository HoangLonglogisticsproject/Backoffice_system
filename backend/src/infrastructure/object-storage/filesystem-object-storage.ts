import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type { Readable } from 'node:stream';
import type { ObjectStorage } from '../../common/types/object-storage.port';
import { assertStorageKey } from './storage-key';

/**
 * Objects as files under one directory — development and tests only; the
 * environment refuses this driver in production (`env.schema`).
 *
 * A write lands in a temporary file and is renamed into place, so a reader
 * never sees half an object, and repeating a write of the same bytes is the
 * same file.
 */
export class FilesystemObjectStorage implements ObjectStorage {
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const target = this.pathOf(key);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    await writeFile(temporary, body, { flag: 'wx' });
    await rename(temporary, target);
  }

  async get(key: string): Promise<Readable> {
    const path = this.pathOf(key);
    // Fails here, before a response starts, rather than mid-stream.
    await access(path);
    return createReadStream(path);
  }

  private pathOf(key: string): string {
    assertStorageKey(key);
    return join(this.root, ...key.split('/'));
  }
}
