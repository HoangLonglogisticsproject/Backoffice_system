import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { translate } from '@/types/translate';

const fetchAllTripSchedules = vi.fn();
const useSession = vi.fn();
const downloadTripScheduleWorkbook = vi.fn();
const notifySuccess = vi.fn();
const notifyError = vi.fn();
const notifyApiError = vi.fn();

vi.mock('@/api/tripSchedule', () => ({
  fetchAllTripSchedules: (...args: unknown[]) => fetchAllTripSchedules(...args),
}));
// The button reads `can('trip.price.read')` to decide whether the sheet gets
// its two money columns, so it needs a session even though nothing else here
// is about authorization.
vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => useSession(),
}));
vi.mock('@/utils/export/tripScheduleWorkbook', () => ({
  downloadTripScheduleWorkbook: (...args: unknown[]) => downloadTripScheduleWorkbook(...args),
}));
// `setToastLanguage` is kept as a real no-op rather than dropped:
// `LanguageProvider` calls it on mount, so a mock without it fails the render
// before any of these tests reach their subject.
vi.mock('@/utils/toast', () => ({
  setToastLanguage: () => {},
  notifySuccess: (...args: unknown[]) => notifySuccess(...args),
  notifyError: (...args: unknown[]) => notifyError(...args),
  notifyApiError: (...args: unknown[]) => notifyApiError(...args),
}));

const { TripScheduleExportButton } = await import('./TripScheduleExportButton');

/**
 * The export button — what it fetches, and what it refuses to produce.
 *
 * SheetJS is mocked out throughout: writing a real workbook is
 * `tripScheduleWorkbook`'s job and needs a DOM download this environment does
 * not have. What is worth pinning here is everything AROUND the file — that the
 * whole range is read rather than the page on screen, and that an empty range
 * produces a message instead of a file.
 */

const RANGE = { from: '2026-08-01', to: '2026-08-31' };

const session = (permissions: string[]) => ({
  state: {
    status: 'ready',
    authorization: { userId: 'u1', username: 'dispatch', role: 'MEMBER', departmentIds: [], permissions },
  },
  can: (p: string) => permissions.includes(p),
  loading: false,
});

/** A head: may see what each trip is sold and bought for. */
const HEAD = ['trip.read', 'trip.price.read'];
/** An ordinary dispatcher: exports the board, with no money in it. */
const DISPATCHER = ['trip.read'];
const vi_ = (key: Parameters<typeof translate>[1]) => translate('vi', key);

const renderButton = () =>
  render(
    <LanguageProvider>
      <TripScheduleExportButton range={RANGE} />
    </LanguageProvider>,
  );

describe('TripScheduleExportButton', () => {
  beforeEach(() => {
    fetchAllTripSchedules.mockReset().mockResolvedValue([{ id: 't1' }]);
    downloadTripScheduleWorkbook.mockReset().mockResolvedValue(1);
    useSession.mockReset().mockReturnValue(session(HEAD));
    notifySuccess.mockReset();
    notifyError.mockReset();
    notifyApiError.mockReset();
  });

  /**
   * ★ THE WHOLE RANGE, AND ALWAYS THE WHOLE BOARD. A file named after a month
   * that silently held one tab's half — or one page of fifty — would be read as
   * that month's record and be wrong.
   */
  it('★ reads every page of the range, across the whole board', async () => {
    renderButton();

    fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));

    await waitFor(() =>
      expect(fetchAllTripSchedules).toHaveBeenCalledWith({ ...RANGE, assignment: 'all' }),
    );
  });

  it('hands the rows to the writer and says how many went out', async () => {
    fetchAllTripSchedules.mockResolvedValue([{ id: 't1' }, { id: 't2' }]);
    downloadTripScheduleWorkbook.mockResolvedValue(2);

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));

    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ trips: [{ id: 't1' }, { id: 't2' }], range: RANGE }),
      ),
    );
    expect(notifySuccess).toHaveBeenCalledWith('exportDone', expect.anything());
  });

  /**
   * ★ WHETHER THE FILE CARRIES MONEY IS DECIDED HERE, NOT IN THE BUILDER.
   *
   * The builder is a pure function with no session, so the one place that can
   * ask `can('trip.price.read')` is the component holding the click. A regression
   * here is a spreadsheet with the company's selling and buying prices in it,
   * emailed on by somebody who was never shown them on screen — which is why
   * both directions are pinned rather than just the allowed one.
   */
  it('★ asks for the price columns when the viewer may see prices', async () => {
    renderButton();
    fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));

    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ includePrices: true }),
      ),
    );
  });

  it('★ asks for a sheet with no money in it when the viewer may not', async () => {
    useSession.mockReturnValue(session(DISPATCHER));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));

    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ includePrices: false }),
      ),
    );
  });

  /**
   * ★ NO FILE FOR AN EMPTY RANGE. A workbook holding a heading row and nothing
   * under it is indistinguishable from a broken export, and somebody would
   * report it as one.
   */
  it('★ says so instead of writing an empty workbook', async () => {
    fetchAllTripSchedules.mockResolvedValue([]);

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('exportEmpty'));
    expect(downloadTripScheduleWorkbook).not.toHaveBeenCalled();
  });

  /**
   * A long range is many requests; a second click during them would start the
   * walk again and download two files.
   */
  it('cannot be pressed twice while it is running', async () => {
    let release: (rows: unknown[]) => void = () => {};
    fetchAllTripSchedules.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    renderButton();
    const button = screen.getByRole('button', { name: vi_('exportExcel') });
    fireEvent.click(button);

    await waitFor(() => expect(screen.getByRole('button')).toBeDisabled());
    fireEvent.click(screen.getByRole('button'));
    expect(fetchAllTripSchedules).toHaveBeenCalledTimes(1);

    release([{ id: 't1' }]);
    await waitFor(() => expect(screen.getByRole('button')).not.toBeDisabled());
  });

  it('reports a refusal rather than failing silently, and frees the button', async () => {
    fetchAllTripSchedules.mockRejectedValue(new Error('boom'));

    renderButton();
    fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));

    await waitFor(() =>
      expect(notifyApiError).toHaveBeenCalledWith(expect.anything(), 'exportFailed'),
    );
    expect(screen.getByRole('button')).not.toBeDisabled();
  });
});
