import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();

vi.mock('./client', () => ({
  API_BASE_URL: '/api',
  httpClient: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

const driver = await import('./driverFuel');
const review = await import('./fuelReview');

/**
 * ★ TWO DOORS, NEVER CROSSED. The driver's calls go to `/driver/…` — never the
 * office's `/fuel-evidence` or `/fuel-reviews` — and the office's decisions to
 * `/fuel-reviews`. No call here pays anybody.
 */
describe('fuel calls', () => {
  beforeEach(() => {
    get.mockReset().mockResolvedValue({ data: [] });
    post.mockReset().mockResolvedValue({ data: {} });
  });

  it('★ stages a driver’s photo through the driver’s own door, as multipart', async () => {
    await driver.stageDriverFuelPhoto(new File(['x'], 'pump.jpg', { type: 'image/jpeg' }));
    const [url, form, config] = post.mock.calls[0] as [string, FormData, { headers: Record<string, string> }];
    expect(url).toBe('/driver/fuel-evidence');
    expect([...form.keys()]).toEqual(['file']);
    expect(config.headers['Content-Type']).toBe('multipart/form-data');
    expect(driver.driverFuelPhotoUrl('img-1')).toBe('/api/driver/fuel-evidence/img-1/content');
  });

  it('lists the driver’s own fills by state, comma-separated — and their waiting photos', async () => {
    await driver.fetchMyFuelSubmissions({ statuses: ['approved', 'paid'] });
    expect(get).toHaveBeenLastCalledWith('/driver/fuel-submissions', { params: { status: 'approved,paid' } });
    await driver.fetchMyFuelSubmissions({ day: '2026-10-08' });
    expect(get).toHaveBeenLastCalledWith('/driver/fuel-submissions', { params: { day: '2026-10-08' } });
    await driver.fetchDriverWaitingPhotos();
    expect(get).toHaveBeenLastCalledWith('/driver/fuel-evidence/staged');
    expect(get.mock.calls.every(([url]) => String(url).startsWith('/driver/'))).toBe(true);
  });

  it('resubmits a fill through the driver’s door', async () => {
    await driver.resubmitFuelSubmission('ft-1', { documentNumber: '7', evidence: [{ id: 'i', type: 'receipt' }] });
    expect(post).toHaveBeenCalledWith('/driver/fuel-submissions/ft-1/resubmit', { documentNumber: '7', evidence: [{ id: 'i', type: 'receipt' }] });
  });

  it('★ decides on a fill at /fuel-reviews — a note only when there is one', async () => {
    await review.decideFuelReview('ft-1', 'approve');
    expect(post).toHaveBeenLastCalledWith('/fuel-reviews/ft-1/approve', {});
    await review.decideFuelReview('ft-1', 'reject', 'Trùng');
    expect(post).toHaveBeenLastCalledWith('/fuel-reviews/ft-1/reject', { note: 'Trùng' });
    await review.fetchFuelReviews('needs_info', 2);
    expect(get).toHaveBeenLastCalledWith('/fuel-reviews', { params: { status: 'needs_info', page: 2, limit: 50 } });
  });
});
