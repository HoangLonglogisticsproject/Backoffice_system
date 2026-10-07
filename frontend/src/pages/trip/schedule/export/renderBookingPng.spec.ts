import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookingExport } from '@/types/bookingExport';
import { bookingDocument } from './bookingExportModel';
import { renderBookingPng } from './renderBookingPng';

/**
 * The renderer against a recording 2D context — jsdom has no canvas. What is
 * pinned is what the PNG must be: drawn from the model alone, after the font,
 * at a fixed width, as tall as its content, with nothing cut off.
 */
const calls: string[] = [];
const drawn: string[] = [];
const texts: Array<{ value: string; x: number; y: number }> = [];
const images: Array<{ src: string; x: number; y: number; width: number; height: number }> = [];
const sizes: Array<{ width: number; height: number }> = [];
/** jsdom decodes no image: the logo's decode is stubbed per test, at LOGO.png's real 879 × 697. */
let logoDecodes = true;
const realDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

const fakeContext = () => ({
  textBaseline: 'alphabetic',
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  imageSmoothingQuality: 'low',
  measureText: (value: string) => {
    calls.push('measure');
    return { width: Array.from(value).length * 8 };
  },
  fillText: (value: string, x: number, y: number) => {
    drawn.push(value);
    texts.push({ value, x, y });
  },
  drawImage: (image: HTMLImageElement, x: number, y: number, width: number, height: number) =>
    images.push({ src: image.src, x, y, width, height }),
  fillRect: (...args: number[]) => calls.push(`fillRect:${args.join(',')}`),
  scale: (x: number) => calls.push(`scale:${x}`),
  beginPath: () => {},
  arc: () => {},
  fill: () => {},
  stroke: () => {},
  moveTo: () => {},
  lineTo: () => {},
});

const booking = (over: Partial<BookingExport> = {}): BookingExport => ({
  scheduledOn: '2026-10-06',
  scheduledPickupAt: '2026-10-06T09:00:00.000Z',
  scheduledDeliveryAt: null,
  pickup: {
    name: 'Kho Củ Chi',
    address: 'Lô B2-7, Đường số 12, Khu công nghiệp Tân Phú Trung, Xã Tân Phú Trung, Huyện Củ Chi, Thành phố Hồ Chí Minh',
    contact: 'Anh Tuấn — 0909 123 456',
  },
  delivery: { name: 'Cửa hàng Nguyễn Huệ', address: '12 Nguyễn Huệ', contact: null },
  customerName: 'Công ty TNHH Thực phẩm Sài Gòn Xanh',
  cargoInfo: '24 kiện · 1.2 tấn · 6 CBM',
  driverInstructions: null,
  crew: [],
  ...over,
});
const render = (over?: Partial<BookingExport>) => renderBookingPng(bookingDocument(booking(over), new Date('2026-10-07T03:05:00Z')));

beforeEach(() => {
  calls.length = 0;
  drawn.length = 0;
  texts.length = 0;
  images.length = 0;
  sizes.length = 0;
  logoDecodes = true;
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    writable: true,
    value: () => (logoDecodes ? Promise.resolve() : Promise.reject(new Error('the image would not decode'))),
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(879);
  vi.spyOn(HTMLImageElement.prototype, 'naturalHeight', 'get').mockReturnValue(697);
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { load: vi.fn(async () => calls.push('font')), ready: Promise.resolve() },
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => fakeContext() as unknown as CanvasRenderingContext2D,
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, done) {
    sizes.push({ width: this.width, height: this.height });
    done(new Blob(['png'], { type: 'image/png' }));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  if (realDecode) Object.defineProperty(HTMLImageElement.prototype, 'decode', realDecode);
  else Reflect.deleteProperty(HTMLImageElement.prototype, 'decode');
});

describe('renderBookingPng', () => {
  it('★ loads the app font for the document`s own text BEFORE measuring anything', async () => {
    await render();
    expect(calls.indexOf('font')).toBeGreaterThanOrEqual(0);
    expect(calls.lastIndexOf('font')).toBeLessThan(calls.indexOf('measure'));
    const sample = vi.mocked(document.fonts.load).mock.calls[0]![1]!;
    expect(sample).toContain('Thực phẩm Sài Gòn Xanh');
    expect(sample).toContain('KHÁCH HÀNG & HÀNG HÓA');
  });

  it('★ a PNG blob, 720 px wide at 2×, on white before any text', async () => {
    const blob = await render();
    expect(blob.type).toBe('image/png');
    expect(sizes[0]!.width).toBe(1440);
    expect(calls.find((call) => call.startsWith('fillRect:0,0,720,'))).toBeDefined();
    expect(calls).toContain('scale:2');
  });

  it('★ draws every word of the long address and the customer — nothing cropped, nothing ellipsized', async () => {
    await render();
    const text = drawn.join(' ');
    for (const word of booking().pickup.address!.split(' ')) expect(text).toContain(word);
    for (const word of booking().customerName!.split(' ')) expect(text).toContain(word);
    expect(text).not.toContain('…');
  });

  it('★ grows with its content: three lorries make a taller image than none, and all three are drawn', async () => {
    await render({ crew: [] });
    await render({
      crew: [
        { plate: '51H27314', driverName: 'Nguyễn Văn A' },
        { plate: '51D65233', driverName: 'Trần Thị Cúc' },
        { plate: '51C33333', driverName: 'Lê Văn Đông' },
      ],
    });
    expect(sizes[1]!.height).toBeGreaterThan(sizes[0]!.height);
    expect(drawn).toEqual(expect.arrayContaining(['Chưa phân công', 'Nguyễn Văn A', 'Trần Thị Cúc', 'Lê Văn Đông']));
  });

  it('★ trades 2× for less to fit a phone browser`s pixel budget — but never below the 1× readability floor', async () => {
    await render({ cargoInfo: 'kiện hàng dễ vỡ '.repeat(1200) });
    expect(sizes[0]!.width).toBeLessThan(1440);
    expect(sizes[0]!.width * sizes[0]!.height).toBeLessThanOrEqual(16_000_000);

    // Past the budget even at 1×, the image grows taller at 1× — text is never shrunk below its size.
    await render({ crew: Array.from({ length: 1000 }, (_, index) => ({ plate: `51H${index}`, driverName: `Tài xế ${index}` })) });
    expect(sizes[1]!.width).toBe(720);
    expect(calls).toContain('scale:1');
  });

  it('★ draws the company logo from the bundled LOGO.png — its own aspect ratio, beside the name, above the title', async () => {
    await render();

    expect(images).toHaveLength(1);
    const logo = images[0]!;
    expect(logo.src).toMatch(/\/assets\/img\/LOGO\.png$/);
    expect(logo.height).toBe(44);
    expect(logo.width / logo.height).toBeCloseTo(879 / 697, 6);
    const brand = texts.find((text) => text.value === 'HOÀNG LONG LOGISTICS')!;
    expect(brand.x).toBeGreaterThanOrEqual(logo.x + logo.width);
    expect(brand.y).toBeGreaterThan(logo.y);
    expect(brand.y).toBeLessThan(logo.y + logo.height);
    expect(texts.find((text) => text.value === 'PHIẾU BOOKING')!.y).toBeGreaterThanOrEqual(logo.y + logo.height);
  });

  it('★ falls back to the text-only header when the logo will not decode — and the export still succeeds', async () => {
    await render();
    const withLogo = sizes[0]!;
    logoDecodes = false;
    images.length = 0;
    texts.length = 0;

    const blob = await render();

    expect(blob.type).toBe('image/png');
    expect(images).toHaveLength(0);
    expect(texts.find((text) => text.value === 'HOÀNG LONG LOGISTICS')!.x).toBe(40);
    // Exactly the header from before the logo: 30 logical px (60 at 2×) shorter.
    expect(withLogo.height - sizes[1]!.height).toBe(60);
  });

  it('rejects when the browser cannot encode the PNG', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((done) => done(null));
    await expect(render()).rejects.toThrow('could not encode');
  });
});
