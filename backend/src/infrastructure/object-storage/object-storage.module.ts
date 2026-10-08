import { Global, Module } from '@nestjs/common';
import { ServiceUnavailableError } from '../../common/errors/domain.error';
import { OBJECT_STORAGE, type ObjectStorage } from '../../common/types/object-storage.port';
import { AppConfig } from '../../config/app.config';
import { FilesystemObjectStorage } from './filesystem-object-storage';
import { R2ObjectStorage } from './r2-object-storage';

/** A deployment with no store: every call is a 503, never a crash at boot. */
const unavailable = (): Promise<never> =>
  Promise.reject(new ServiceUnavailableError('File storage is not configured on this deployment.'));

export const UNCONFIGURED_STORAGE: ObjectStorage = { put: unavailable, get: unavailable };

/** Picks the adapter the environment names. The schema has already validated it. */
export function objectStorageFor(config: AppConfig): ObjectStorage {
  const settings = config.objectStorage;
  switch (settings.driver) {
    case 'r2':
      return new R2ObjectStorage(settings.r2);
    case 'filesystem':
      return new FilesystemObjectStorage(settings.root);
    default:
      return UNCONFIGURED_STORAGE;
  }
}

/**
 * Binds the `OBJECT_STORAGE` port, globally, as `DatabaseModule` binds
 * `DATABASE`: capabilities inject the port and never name a provider.
 */
@Global()
@Module({
  providers: [{ provide: OBJECT_STORAGE, useFactory: objectStorageFor, inject: [AppConfig] }],
  exports: [OBJECT_STORAGE],
})
export class ObjectStorageModule {}
