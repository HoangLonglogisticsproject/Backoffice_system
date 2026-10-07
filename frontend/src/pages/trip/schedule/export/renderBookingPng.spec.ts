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
/** Each string as drawn: where, against which edge, and how wide. */
const texts: Array<{ value: string; x: number; y: number; align: string; width: number }> = [];
const images: Array<{ src: string; x: number; y: number; width: number; height: number }> = [];
const sizes: Array<{ width: number; height: number }> = [];
/** Each stroked `Path2D` — the section icons — with where the context had been moved to. */
const icons: Array<{ d: string; x: number; y: number }> = [];
let origin = { x: 0, y: 0 };
/** jsdom decodes no image: the logo's decode is stubbed per test, at LOGO.png's real 879 × 697. */
let logoDecodes = true;
const realDecode = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'decode');

/** The fake face: every character 8 px wide. */
const widthOf = (value: string) => Array.from(value).length * 8;
const fakeContext = () => ({
  textBaseline: 'alphabetic',
  textAlign: 'left',
  font: '',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  imageSmoothingQuality: 'low',
  measureText: (value: string) => {
    calls.push('measure');
    return { width: widthOf(value) };
  },
  fillText(this: { textAlign: string }, value: string, x: number, y: number) {
    drawn.push(value);
    texts.push({ value, x, y, align: this.textAlign, width: widthOf(value) });
  },
  drawImage: (image: HTMLImageElement, x: number, y: number, width: number, height: number) =>
    images.push({ src: image.src, x, y, width, height }),
  fillRect: (...args: number[]) => calls.push(`fillRect:${args.join(',')}`),
  scale: (x: number) => calls.push(`scale:${x}`),
  save: () => {},
  restore: () => {
    origin = { x: 0, y: 0 };
  },
  translate: (x: number, y: number) => {
    origin = { x, y };
  },
  setLineDash: () => {},
  beginPath: () => {},
  arc: () => {},
  fill: () => {},
  stroke: (path?: { d: string }) => {
    if (path) icons.push({ d: path.d, ...origin });
  },
  moveTo: () => {},
  lineTo: () => {},
  arcTo: () => {},
  closePath: () => {},
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
const THREE = [
  { plate: '51H27314', driverName: 'Nguyễn Văn A' },
  { plate: '51D65233', driverName: 'Trần Thị Cúc' },
  { plate: '51C33333', driverName: 'Lê Văn Đông' },
];
/** The first drawing of `value`. */
const at = (value: string) => texts.find((text) => text.value === value)!;
/** A drawn string's left and right edges, whichever edge it was set against. */
const edges = (text: (typeof texts)[number]) => (text.align === 'right' ? [text.x - text.width, text.x] : [text.x, text.x + text.width]);

beforeEach(() => {
  calls.length = 0;
  drawn.length = 0;
  texts.length = 0;
  images.length = 0;
  sizes.length = 0;
  icons.length = 0;
  logoDecodes = true;
  // jsdom has no Path2D: keep the path data, which is what the icons are.
  vi.stubGlobal(
    'Path2D',
    class {
      d: string;
      constructor(d: string) {
        this.d = d;
      }
    },
  );
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
  vi.unstubAllGlobals();
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
    await render({ crew: THREE });
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

  it('★ the header reads top-down, left-aligned: LOGO.png and the name as one lockup, PHIẾU BOOKING below it, the subtitle below that', async () => {
    await render();

    expect(images).toHaveLength(1);
    const logo = images[0]!;
    expect(logo.src).toMatch(/\/assets\/img\/LOGO\.png$/);
    expect(logo).toMatchObject({ x: 48, height: 52 });
    expect(logo.width / logo.height).toBeCloseTo(879 / 697, 6);
    const brand = at('HOÀNG LONG LOGISTICS');
    expect(brand.x).toBeGreaterThan(logo.x + logo.width);
    expect(brand.y + 11).toBeCloseTo(logo.y + logo.height / 2); // a 22 px line, centred on the mark
    const title = at('PHIẾU BOOKING');
    expect(title).toMatchObject({ align: 'left', x: 48 });
    expect(title.y).toBeGreaterThanOrEqual(logo.y + logo.height);
    const subtitle = at('Booking confirmation');
    expect(subtitle).toMatchObject({ align: 'left', x: 48 });
    expect(subtitle.y).toBeGreaterThan(title.y);
    // Nothing in the header is set against the right edge.
    expect(texts.filter((text) => text.y <= subtitle.y).every((text) => text.align === 'left')).toBe(true);
  });

  it('★ one icon per section heading, in order — clock, pin, package, truck — on a tile left of its title', async () => {
    await render({ crew: THREE, driverInstructions: 'Gọi trước 30 phút' });

    // lucide's geometry, recognised by a stroke only that icon has.
    const kinds = icons.map(({ d }) =>
      d.includes('M12 6v6l4 2') ? 'clock' : d.includes('C9.539') ? 'pin' : d.includes('M12 22V12') ? 'package' : d.includes('M15 18H9') ? 'truck' : d,
    );
    expect(kinds).toEqual(['clock', 'pin', 'package', 'truck']);
    const headings = ['THỜI GIAN', 'LỘ TRÌNH', 'KHÁCH HÀNG & HÀNG HÓA', 'XE & TÀI XẾ'].map(at);
    icons.forEach((icon, index) => {
      const heading = headings[index]!;
      expect(icon.x).toBeLessThan(heading.x); // the tile leads the title …
      expect(Math.abs(icon.y + 8 - (heading.y + 4.32))).toBeLessThan(2); // … level with its capitals
    });
    // Nothing else on the sheet is an icon: one per section, none per line.
    expect(icons).toHaveLength(4);
  });

  it('★ falls back to a text-only lockup when the logo will not decode — and the export still succeeds', async () => {
    logoDecodes = false;

    const blob = await render();

    expect(blob.type).toBe('image/png');
    expect(images).toHaveLength(0);
    expect(at('HOÀNG LONG LOGISTICS').x).toBe(48);
    expect(at('PHIẾU BOOKING')).toMatchObject({ align: 'left', x: 48 });
    expect(at('PHIẾU BOOKING').y).toBeGreaterThan(at('HOÀNG LONG LOGISTICS').y);
  });

  it('★ "Thời gian" is the time summary: a column per end — label, day, then the hour beneath', async () => {
    await render({ scheduledDeliveryAt: '2026-10-08T03:00:00.000Z' });
    const pickup = { label: at('LẤY HÀNG'), day: at('Thứ Ba, 06/10/2026'), time: at('16:00') };
    const delivery = { label: at('GIAO HÀNG'), day: at('Thứ Năm, 08/10/2026'), time: at('10:00') };
    for (const end of [pickup, delivery]) {
      expect(end.day.x).toBe(end.label.x);
      expect(end.day.y).toBeGreaterThan(end.label.y);
      expect(end.time.y).toBeGreaterThan(end.day.y);
    }
    expect(delivery.label.y).toBe(pickup.label.y);
    expect(delivery.label.x).toBeGreaterThan(edges(pickup.day)[1]);

    // No delivery booked: its column is simply not there — no placeholder.
    texts.length = 0;
    await render({ scheduledDeliveryAt: null });
    expect(texts.some((text) => text.value === 'GIAO HÀNG' || text.value === '—')).toBe(false);
  });

  it('★ nothing leaves the page: every string, long ones wrapped, sits inside the 48 px margins', async () => {
    await render({ cargoInfo: 'Hàng đông lạnh giữ nhiệt độ −18°C '.repeat(12), crew: THREE });
    for (const text of texts) {
      const [left, right] = edges(text);
      expect(left).toBeGreaterThanOrEqual(48);
      expect(right).toBeLessThanOrEqual(672);
    }
  });

  it('★ the route reads top-down, pickup then delivery: label, place, address — and no date or hour repeated from "Thời gian"', async () => {
    await render({ scheduledDeliveryAt: '2026-10-08T03:00:00.000Z' });
    for (const moment of ['Thứ Ba, 06/10/2026', '16:00', 'Thứ Năm, 08/10/2026', '10:00']) {
      expect(texts.filter((text) => text.value.includes(moment))).toHaveLength(1);
    }
    const pickup = at('ĐIỂM LẤY HÀNG');
    expect(pickup.y).toBeGreaterThan(at('16:00').y);
    expect(at('Kho Củ Chi').y).toBeGreaterThan(pickup.y);
    const address = texts.find((text) => text.value.startsWith('Lô B2-7'))!;
    expect(address.y).toBeGreaterThan(at('Kho Củ Chi').y);
    expect(address.x).toBe(at('Kho Củ Chi').x);
    expect(at('ĐIỂM GIAO HÀNG').y).toBeGreaterThan(at('Liên hệ: Anh Tuấn — 0909 123 456').y);
  });

  it('★ several lorries: one row each, the plate leading and its driver beside it — never squashed into one line', async () => {
    await render({ crew: THREE });
    const rows = [
      ['51H-27314', 'Nguyễn Văn A'],
      ['51D-65233', 'Trần Thị Cúc'],
      ['51C-33333', 'Lê Văn Đông'],
    ].map(([plate, driver]) => ({ plate: at(plate!), driver: at(driver!) }));
    for (const { plate, driver } of rows) {
      expect(driver.x).toBeGreaterThan(plate.x + plate.width);
      expect(Math.abs(driver.y - plate.y)).toBeLessThanOrEqual(1);
    }
    expect(rows[1]!.plate.y).toBeGreaterThanOrEqual(rows[0]!.plate.y + 28);
    expect(rows[2]!.plate.y).toBeGreaterThanOrEqual(rows[1]!.plate.y + 28);
  });

  it('the footer, quiet and last: when it was exported, then what it is for, both left-aligned', async () => {
    await render();
    const exported = at('Ngày xuất: Thứ Tư, 07/10/2026 · 10:05');
    const note = at('Thông tin phục vụ xác nhận và vận hành booking.');
    expect(exported).toMatchObject({ x: 48, align: 'left' });
    expect(note).toMatchObject({ x: 48, align: 'left' });
    expect(note.y).toBeGreaterThan(exported.y);
    expect(Math.max(...texts.map((text) => text.y))).toBe(note.y);
  });

  it('rejects when the browser cannot encode the PNG', async () => {
    vi.mocked(HTMLCanvasElement.prototype.toBlob).mockImplementation((done) => done(null));
    await expect(render()).rejects.toThrow('could not encode');
  });
});
