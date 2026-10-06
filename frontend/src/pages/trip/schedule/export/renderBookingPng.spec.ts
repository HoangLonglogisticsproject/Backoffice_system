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
const sizes: Array<{ width: number; height: number }> = [];

const fakeContext = () => ({
  textBaseline: 'alphabetic',
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  measureText: (value: string) => {
    calls.push('measure');
    return { width: Array.from(value).length * 8 };
  },
  fillText: (value: string) => drawn.push(value),
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
  sizes.length = 0;
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

  it('drops to 1× rather than fail when a very long document would exceed what a phone browser draws', async () => {
    await render({ cargoInfo: 'kiện hàng dễ vỡ '.repeat(1200) });
    expect(sizes[0]!.width).toBe(720);
  });

  it('rejects when the browser cannot encode the PNG', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((done) => done(null));
    await expect(render()).rejects.toThrow('could not encode');
  });
});
