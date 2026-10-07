import type { UserSummary } from '../../../common/types/user-summary';

/**
 * The images that prove a fill (0037) — a pump meter, a Timemark photo, a
 * voucher, a receipt, a tax invoice. Owned by a fuel transaction, never by a
 * cost line directly; staged by an uploader first, then attached by a command.
 */

/** What a person says an image is. `null` is unclassified; there is no `other`. */
export const FUEL_EVIDENCE_TYPES = ['pump_meter', 'timemark', 'fuel_voucher', 'receipt', 'tax_invoice'] as const;
export type FuelEvidenceType = (typeof FUEL_EVIDENCE_TYPES)[number];

export type EvidenceImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/**
 * ★ THE BUSINESS CAP, BELOW THE TRANSPORT ONE. nginx accepts 2 MiB per request
 * (`client_max_body_size 2m`) and the multipart framing needs a little of
 * that, so a file is held to 2 000 000 bytes — the same number 0037's CHECK
 * holds. The browser downsizes phone photos far below it.
 */
export const MAX_EVIDENCE_BYTES = 2_000_000;
/** The request ceiling multer enforces before any of this runs — nginx's 2m. */
export const TRANSPORT_LIMIT_BYTES = 2 * 1024 * 1024;
export const MAX_EVIDENCE_PER_TRANSACTION = 10;
export const MAX_STAGED_PER_UPLOADER = 30;

/** Content-addressed: identical bytes are one object, whoever uploaded them. */
export const evidenceStorageKey = (sha256: string): string => `fuel-evidence/${sha256}`;

export const EXTENSION_OF: Readonly<Record<EvidenceImageType, string>> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** `details.file` codes on the 422 an upload can earn. */
export const FILE_EMPTY = 'FILE_EMPTY';
export const FILE_TOO_LARGE = 'FILE_TOO_LARGE';
export const HEIC_NOT_SUPPORTED = 'HEIC_NOT_SUPPORTED';
export const UNSUPPORTED_IMAGE_FORMAT = 'UNSUPPORTED_IMAGE_FORMAT';
export const TOO_MANY_STAGED = 'TOO_MANY_STAGED';

export type SniffedImage =
  | { kind: 'image'; mimeType: EvidenceImageType }
  | { kind: 'heic' }
  | { kind: 'unsupported' };

const startsWith = (bytes: Uint8Array, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((byte, i) => bytes[offset + i] === byte);

const ascii = (text: string): number[] => [...text].map((char) => char.codePointAt(0) ?? 0);

/** ISO-BMFF brands of the HEIF family — iPhone photos, and AVIF with them. */
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1', 'avif', 'avis']);

/**
 * ★ WHAT THE BYTES ARE, NOT WHAT THE CLIENT SAID. A request's Content-Type is
 * the sender's claim; the first bytes of the file are the format. Only JPEG,
 * PNG and WebP are evidence in this phase. A HEIC photo is told apart so the
 * message can say what to do: take the photo directly, or pick a JPEG.
 */
export function sniffImage(bytes: Uint8Array): SniffedImage {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', mimeType: 'image/jpeg' };
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mimeType: 'image/png' };
  }
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) {
    return { kind: 'image', mimeType: 'image/webp' };
  }
  if (startsWith(bytes, ascii('ftyp'), 4) && bytes.length >= 12) {
    const brand = String.fromCodePoint(...bytes.subarray(8, 12));
    if (HEIF_BRANDS.has(brand)) return { kind: 'heic' };
  }
  return { kind: 'unsupported' };
}

/**
 * The name the file had on the sender's device — kept as a label only, never
 * in a storage key or a response header. Path parts and control characters
 * are dropped; an empty result is no name at all.
 */
export function safeFilename(name: string | undefined): string | null {
  if (!name) return null;
  const base = name.split(/[\\/]/).pop() ?? '';
  const printable = [...base].filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code > 0x1f && code !== 0x7f;
  });
  const clean = printable.join('').trim().slice(0, 255);
  return clean === '' ? null : clean;
}

/** One image, as the office sees it. */
export interface FuelEvidence {
  id: string;
  sha256: string;
  mimeType: EvidenceImageType;
  byteSize: number;
  originalFilename: string | null;
  evidenceType: FuelEvidenceType | null;
  capturedAt: Date | null;
  uploadedBy: UserSummary;
  uploadedAt: Date;
  fuelTransactionId: string | null;
  attachedAt: Date | null;
  retiredAt: Date | null;
  retireReason: string | null;
}

/** What a command says about one staged image as it attaches it. */
export interface EvidenceAttachment {
  id: string;
  type?: FuelEvidenceType;
  capturedAt?: Date;
}
