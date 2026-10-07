import { evidenceStorageKey, safeFilename, sniffImage } from './fuel-evidence';

const bytes = (...values: number[]) => Uint8Array.from(values);
const ascii = (text: string) => [...text].map((char) => char.charCodeAt(0));
const ftyp = (brand: string) => bytes(0, 0, 0, 0x18, ...ascii('ftyp'), ...ascii(brand), 0, 0, 0, 0);

describe('sniffImage — the bytes decide, not the sender', () => {
  it('recognises JPEG, PNG and WebP by their signatures', () => {
    expect(sniffImage(bytes(0xff, 0xd8, 0xff, 0xe0, 0, 0))).toEqual({ kind: 'image', mimeType: 'image/jpeg' });
    expect(sniffImage(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toEqual({
      kind: 'image',
      mimeType: 'image/png',
    });
    expect(sniffImage(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WEBP'), ...ascii('VP8 ')))).toEqual({
      kind: 'image',
      mimeType: 'image/webp',
    });
  });

  it.each(['heic', 'heix', 'mif1', 'msf1', 'avif'])('tells a HEIF-family photo (%s) apart, so the message can help', (brand) => {
    expect(sniffImage(ftyp(brand))).toEqual({ kind: 'heic' });
  });

  it('refuses everything else — a PDF, an MP4, text, an empty or truncated file', () => {
    expect(sniffImage(bytes(...ascii('%PDF-1.7')))).toEqual({ kind: 'unsupported' });
    expect(sniffImage(ftyp('isom'))).toEqual({ kind: 'unsupported' });
    expect(sniffImage(bytes(...ascii('<svg xmlns')))).toEqual({ kind: 'unsupported' });
    expect(sniffImage(bytes())).toEqual({ kind: 'unsupported' });
    expect(sniffImage(bytes(0xff, 0xd8))).toEqual({ kind: 'unsupported' });
    expect(sniffImage(bytes(...ascii('RIFF'), 1, 2, 3, 4, ...ascii('WAVE')))).toEqual({ kind: 'unsupported' });
  });
});

describe('evidence naming', () => {
  it('keys an object by its content, so identical bytes are one object', () => {
    expect(evidenceStorageKey('a'.repeat(64))).toBe(`fuel-evidence/${'a'.repeat(64)}`);
  });

  it('keeps a device filename as a label only — no path, no control characters', () => {
    expect(safeFilename('C:\\Users\\me\\IMG_0042.JPG')).toBe('IMG_0042.JPG');
    expect(safeFilename('../../etc/passwd')).toBe('passwd');
    expect(safeFilename('hoa\u0000don\u001f.jpg')).toBe('hoadon.jpg');
    expect(safeFilename('   ')).toBeNull();
    expect(safeFilename(undefined)).toBeNull();
    expect(safeFilename('x'.repeat(300))).toHaveLength(255);
  });
});
