import { createHash } from 'node:crypto';
import type { Readable } from 'node:stream';
import { Inject, Injectable } from '@nestjs/common';
import { ConflictError, NotFoundError, ValidationError } from '../../../common/errors/domain.error';
import { OBJECT_STORAGE, type ObjectStorage } from '../../../common/types/object-storage.port';
import {
  EXTENSION_OF,
  FILE_EMPTY,
  FILE_TOO_LARGE,
  HEIC_NOT_SUPPORTED,
  MAX_EVIDENCE_BYTES,
  MAX_STAGED_PER_UPLOADER,
  TOO_MANY_STAGED,
  UNSUPPORTED_IMAGE_FORMAT,
  evidenceStorageKey,
  safeFilename,
  sniffImage,
  type EvidenceImageType,
  type FuelEvidence,
} from '../domain/fuel-evidence';
import { FuelEvidenceRepository, publicEvidence } from '../persistence/fuel-evidence.repository';

const refused = (code: string, message: string) => new ValidationError(message, { file: code });

/**
 * Evidence files (0037): staged by an uploader, attached later by a command.
 *
 * ★ THE BYTES DECIDE. The format comes from the file's first bytes, the
 * identity from its SHA-256, the name from nothing a header can carry. A HEIC
 * photo is refused with a message saying what to do instead — no server-side
 * conversion, no image library.
 *
 * ★ STORED ONCE. Objects are content-addressed, so the second upload of the
 * same bytes — by anybody — writes no second object, and a retry by the same
 * uploader is the same staged row.
 */
@Injectable()
export class FuelEvidenceService {
  constructor(
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly evidence: FuelEvidenceRepository,
  ) {}

  async stage(file: { buffer: Buffer; originalname?: string }, uploadedBy: string): Promise<FuelEvidence> {
    const bytes = file.buffer;
    if (bytes.length === 0) throw refused(FILE_EMPTY, 'The file is empty.');
    if (bytes.length > MAX_EVIDENCE_BYTES) throw refused(FILE_TOO_LARGE, 'An image may be at most 2 MB.');
    const sniffed = sniffImage(bytes);
    if (sniffed.kind === 'heic') {
      throw refused(HEIC_NOT_SUPPORTED, 'HEIC photos are not supported — take the photo directly, or choose a JPEG or PNG.');
    }
    if (sniffed.kind !== 'image') throw refused(UNSUPPORTED_IMAGE_FORMAT, 'Only JPEG, PNG or WebP images are accepted.');

    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const already = await this.evidence.findStaged(uploadedBy, sha256);
    if (already) return publicEvidence(already);
    // ponytail: counted without a lock — two parallel uploads may land one over; the cap bounds abuse, not accuracy.
    if ((await this.evidence.countStaged(uploadedBy)) >= MAX_STAGED_PER_UPLOADER) {
      throw refused(TOO_MANY_STAGED, `At most ${MAX_STAGED_PER_UPLOADER} images may wait to be attached — attach or discard some first.`);
    }

    const storageKey = evidenceStorageKey(sha256);
    // Before the row: a row is never written for bytes the store does not hold.
    if (!(await this.evidence.objectStored(sha256))) await this.storage.put(storageKey, bytes, sniffed.mimeType);

    const staged = await this.evidence.insertStaged({
      sha256,
      storageKey,
      mimeType: sniffed.mimeType,
      byteSize: bytes.length,
      originalFilename: safeFilename(file.originalname),
      uploadedBy,
    });
    return publicEvidence(staged);
  }

  /** Only the uploader's own image, and only while it waits. */
  async discard(id: string, by: string): Promise<void> {
    if (!(await this.evidence.discard(id, by, new Date()))) throw new NotFoundError('Staged evidence not found.');
  }

  /**
   * The bytes of an image a reader may see: anything attached to a fill
   * (retired ones too — history stays readable), or their own staged upload.
   * Somebody else's staged file, or a discarded one, answers as not there.
   */
  async content(
    id: string,
    reader: string,
  ): Promise<{ stream: Readable; mimeType: EvidenceImageType; byteSize: number; filename: string }> {
    const row = await this.evidence.findById(id);
    const visible = row && !row.discardedAt && (row.attachedAt !== null || row.uploadedBy.id === reader);
    if (!row || !visible) throw new NotFoundError('Evidence not found.');
    return {
      stream: await this.storage.get(row.storageKey),
      mimeType: row.mimeType,
      byteSize: row.byteSize,
      filename: `${row.id}.${EXTENSION_OF[row.mimeType]}`,
    };
  }

  /** Withdraws an attached image — never deletes it. The SuperAdmin's, with a reason. */
  async retire(id: string, reason: string, by: string): Promise<FuelEvidence> {
    const why = reason.trim();
    if (why === '') throw new ValidationError('Retiring evidence needs a reason.', { reason: 'REQUIRED' });
    if (!(await this.evidence.retire(id, by, why, new Date()))) {
      const row = await this.evidence.findById(id);
      if (!row?.attachedAt) throw new NotFoundError('Attached evidence not found.');
      throw new ConflictError('That evidence has already been retired.');
    }
    const retired = await this.evidence.findById(id);
    if (!retired) throw new Error('Retired evidence vanished.');
    return publicEvidence(retired);
  }
}
