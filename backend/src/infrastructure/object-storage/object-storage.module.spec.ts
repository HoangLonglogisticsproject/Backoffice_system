import type { AppConfig, ObjectStorageConfig } from '../../config/app.config';
import { FilesystemObjectStorage } from './filesystem-object-storage';
import { UNCONFIGURED_STORAGE, objectStorageFor } from './object-storage.module';
import { R2ObjectStorage } from './r2-object-storage';

const config = (objectStorage: Partial<ObjectStorageConfig>) =>
  ({
    objectStorage: {
      driver: 'none',
      root: '',
      r2: { accountId: '', bucket: '', accessKeyId: '', secretAccessKey: '' },
      ...objectStorage,
    },
  }) as unknown as AppConfig;

describe('objectStorageFor', () => {
  it('★ gives a deployment with no store a 503 on use — never a crash at boot', async () => {
    const storage = objectStorageFor(config({ driver: 'none' }));
    expect(storage).toBe(UNCONFIGURED_STORAGE);
    await expect(storage.put('fuel-evidence/x', Buffer.from('x'), 'image/png')).rejects.toMatchObject({
      code: 'SERVICE_UNAVAILABLE',
    });
    await expect(storage.get('fuel-evidence/x')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('builds the adapter the environment names', () => {
    expect(objectStorageFor(config({ driver: 'filesystem', root: '/tmp/evidence' }))).toBeInstanceOf(
      FilesystemObjectStorage,
    );
    expect(
      objectStorageFor(
        config({
          driver: 'r2',
          r2: { accountId: '0'.repeat(32), bucket: 'evidence', accessKeyId: 'A'.repeat(20), secretAccessKey: 's'.repeat(64) },
        }),
      ),
    ).toBeInstanceOf(R2ObjectStorage);
  });
});
