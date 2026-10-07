import { Inject, Injectable } from '@nestjs/common';
import { DATABASE, type Database, type DatabaseQuery } from '../../../common/types/database.port';
import type {
  EvidenceAttachment,
  EvidenceImageType,
  FuelEvidence,
  FuelEvidenceType,
} from '../domain/fuel-evidence';

/** Evidence rows (0037). No DELETE: staged files are discarded, attached ones retired — once each. */
interface EvidenceRow {
  id: string;
  sha256: string;
  storage_key: string;
  mime_type: EvidenceImageType;
  byte_size: number;
  original_filename: string | null;
  evidence_type: FuelEvidenceType | null;
  captured_at: Date | null;
  uploaded_by: string;
  uploaded_by_name: string;
  uploaded_at: Date;
  discarded_at: Date | null;
  fuel_transaction_id: string | null;
  attached_at: Date | null;
  retired_at: Date | null;
  retire_reason: string | null;
}

/** A row with what the service needs beyond the API shape. */
export type StoredEvidence = FuelEvidence & { storageKey: string; discardedAt: Date | null };

const SELECT = `SELECT e.id, e.sha256, e.storage_key, e.mime_type, e.byte_size, e.original_filename,
                       e.evidence_type, e.captured_at, e.uploaded_by, u.display_name AS uploaded_by_name,
                       e.uploaded_at, e.discarded_at, e.fuel_transaction_id, e.attached_at,
                       e.retired_at, e.retire_reason
                  FROM fuel_transaction_evidence e
                  JOIN users u ON u.id = e.uploaded_by`;

const toEvidence = (row: EvidenceRow): StoredEvidence => ({
  id: row.id,
  sha256: row.sha256,
  mimeType: row.mime_type,
  byteSize: row.byte_size,
  originalFilename: row.original_filename,
  evidenceType: row.evidence_type,
  capturedAt: row.captured_at,
  uploadedBy: { id: row.uploaded_by, displayName: row.uploaded_by_name },
  uploadedAt: row.uploaded_at,
  fuelTransactionId: row.fuel_transaction_id,
  attachedAt: row.attached_at,
  retiredAt: row.retired_at,
  retireReason: row.retire_reason,
  storageKey: row.storage_key,
  discardedAt: row.discarded_at,
});

/** The API shape: storage details never leave the server. */
export const publicEvidence = ({ storageKey: _key, discardedAt: _discarded, ...evidence }: StoredEvidence): FuelEvidence =>
  evidence;

@Injectable()
export class FuelEvidenceRepository {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async findById(id: string, executor: DatabaseQuery = this.db): Promise<StoredEvidence | null> {
    const [row] = await executor.query<EvidenceRow>(`${SELECT} WHERE e.id = $1`, [id]);
    return row ? toEvidence(row) : null;
  }

  async findStaged(uploader: string, sha256: string): Promise<StoredEvidence | null> {
    const [row] = await this.db.query<EvidenceRow>(
      `${SELECT} WHERE e.uploaded_by = $1 AND e.sha256 = $2 AND e.attached_at IS NULL AND e.discarded_at IS NULL`,
      [uploader, sha256],
    );
    return row ? toEvidence(row) : null;
  }

  async countStaged(uploader: string): Promise<number> {
    const [row] = await this.db.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM fuel_transaction_evidence
        WHERE uploaded_by = $1 AND attached_at IS NULL AND discarded_at IS NULL`,
      [uploader],
    );
    return row?.count ?? 0;
  }

  /** Whether these bytes are already in the store — content-addressed, so one copy serves all. */
  async objectStored(sha256: string): Promise<boolean> {
    const rows = await this.db.query(`SELECT 1 FROM fuel_transaction_evidence WHERE sha256 = $1 LIMIT 1`, [sha256]);
    return rows.length > 0;
  }

  /** Stages a file; the twin of a racing retry answers with the row that won. */
  async insertStaged(input: {
    sha256: string;
    storageKey: string;
    mimeType: EvidenceImageType;
    byteSize: number;
    originalFilename: string | null;
    uploadedBy: string;
  }): Promise<StoredEvidence> {
    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO fuel_transaction_evidence (sha256, storage_key, mime_type, byte_size, original_filename, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (uploaded_by, sha256) WHERE attached_at IS NULL AND discarded_at IS NULL DO NOTHING
       RETURNING id`,
      [input.sha256, input.storageKey, input.mimeType, input.byteSize, input.originalFilename, input.uploadedBy],
    );
    const row = inserted[0] ? await this.findById(inserted[0].id) : await this.findStaged(input.uploadedBy, input.sha256);
    if (row) return row;
    throw new Error('A staged evidence row was neither written nor found.');
  }

  async discard(id: string, uploader: string, now: Date): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE fuel_transaction_evidence SET discarded_at = $3, discarded_by = $2
        WHERE id = $1 AND uploaded_by = $2 AND attached_at IS NULL AND discarded_at IS NULL
       RETURNING id`,
      [id, uploader, now],
    );
    return rows.length > 0;
  }

  async retire(id: string, by: string, reason: string, now: Date): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE fuel_transaction_evidence SET retired_at = $4, retired_by = $2, retire_reason = $3
        WHERE id = $1 AND attached_at IS NOT NULL AND retired_at IS NULL
       RETURNING id`,
      [id, by, reason, now],
    );
    return rows.length > 0;
  }

  async lockMany(ids: readonly string[], tx: DatabaseQuery): Promise<StoredEvidence[]> {
    const rows = await tx.query<EvidenceRow>(`${SELECT} WHERE e.id = ANY($1::uuid[]) FOR UPDATE OF e`, [ids]);
    return rows.map(toEvidence);
  }

  /** The images on a fill that still count — the ones a new image may not repeat. */
  async liveOn(fuelTransactionId: string, tx: DatabaseQuery): Promise<{ id: string; sha256: string }[]> {
    return tx.query(
      `SELECT id, sha256 FROM fuel_transaction_evidence WHERE fuel_transaction_id = $1 AND retired_at IS NULL`,
      [fuelTransactionId],
    );
  }

  async attach(item: EvidenceAttachment, fuelTransactionId: string, by: string, now: Date, tx: DatabaseQuery) {
    await tx.query(
      `UPDATE fuel_transaction_evidence
          SET fuel_transaction_id = $2, attached_by = $3, attached_at = $4,
              evidence_type = COALESCE($5, evidence_type), captured_at = COALESCE($6, captured_at)
        WHERE id = $1 AND attached_at IS NULL AND discarded_at IS NULL`,
      [item.id, fuelTransactionId, by, now, item.type ?? null, item.capturedAt ?? null],
    );
  }

  /** Every image a fill has had, retired ones included — evidence history stays readable. */
  async listByTransaction(fuelTransactionId: string): Promise<StoredEvidence[]> {
    const rows = await this.db.query<EvidenceRow>(
      `${SELECT} WHERE e.fuel_transaction_id = $1 ORDER BY e.attached_at, e.id`,
      [fuelTransactionId],
    );
    return rows.map(toEvidence);
  }
}
