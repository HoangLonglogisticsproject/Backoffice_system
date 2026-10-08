import { describe, expect, it } from 'vitest';
import { ApiError } from '@/utils/errors';
import { isOnAnotherFill, uploadErrorKey } from './useFuelReceipt';

/** What an upload refusal and a stale attach are told, in this screen's words. */
describe('fuel receipt refusals', () => {
  it.each([
    [new ApiError(503, 'SERVICE_UNAVAILABLE', 'no store'), 'fuelStorageUnavailable'],
    [new ApiError(413, undefined, 'too large'), 'fuelImageTooLarge'],
    [new ApiError(422, 'VALIDATION_FAILED', 'x', { file: 'FILE_TOO_LARGE' }), 'fuelImageTooLarge'],
    [new ApiError(422, 'VALIDATION_FAILED', 'x', { file: 'HEIC_NOT_SUPPORTED' }), 'fuelImageHeic'],
    [new ApiError(422, 'VALIDATION_FAILED', 'x', { file: 'TOO_MANY_STAGED' }), 'fuelTooManyStaged'],
    [new ApiError(422, 'VALIDATION_FAILED', 'x', { file: 'UNSUPPORTED_IMAGE_FORMAT' }), 'fuelImageUnsupported'],
    [new ApiError(0, undefined, 'offline'), 'fuelUploadFailed'],
    [new Error('boom'), 'fuelUploadFailed'],
  ])('maps %o to %s', (error, key) => {
    expect(uploadErrorKey(error)).toBe(key);
  });

  it('recognises a receipt that is already on another fill, whichever part matched', () => {
    expect(isOnAnotherFill(new ApiError(422, 'VALIDATION_FAILED', 'x', { evidence: 'ON_ANOTHER_FILL' }))).toBe(true);
    expect(isOnAnotherFill(new ApiError(422, 'VALIDATION_FAILED', 'x', { documentNumber: 'ON_ANOTHER_FILL' }))).toBe(true);
    expect(isOnAnotherFill(new ApiError(422, 'VALIDATION_FAILED', 'x', { evidence: 'NOT_STAGED' }))).toBe(false);
  });
});
