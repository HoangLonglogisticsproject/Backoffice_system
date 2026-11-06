import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { translate } from '@/types/translate';
import { ApiError } from '@/utils/errors';

const fetchTripExportSnapshot = vi.fn();
const useSession = vi.fn();
const downloadTripScheduleWorkbook = vi.fn();
const notifySuccess = vi.fn();
const notifyError = vi.fn();
const notifyApiError = vi.fn();

vi.mock('@/api/tripSchedule', () => ({
  fetchTripExportSnapshot: (...args: unknown[]) => fetchTripExportSnapshot(...args),
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
 * The export button and its dialog — what the file is asked to hold, and what
 * the person is told before and after.
 *
 * SheetJS is mocked out throughout: writing a real workbook is
 * `tripScheduleWorkbook`'s job. What is pinned here is everything AROUND the
 * file — that the scope is this screen unless both are CHOSEN, that the range
 * and the applied search are restated and sent, and that success is said only
 * once a file was written.
 */

const RANGE = { from: '2026-11-02', to: '2026-11-08' };
const READ_AT = '2026-11-05T08:42:07.000Z';

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
const vi_ = (key: Parameters<typeof translate>[1]) => translate('vi', key);

const renderButton = (lifecycle?: 'operational' | 'history', customer?: string) =>
  render(
    <LanguageProvider>
      <TripScheduleExportButton range={RANGE} lifecycle={lifecycle} customer={customer} />
    </LanguageProvider>,
  );

const openDialog = () => {
  fireEvent.click(screen.getByRole('button', { name: vi_('exportExcel') }));
  return screen.getByRole('dialog');
};
const exportFile = () => fireEvent.click(screen.getByRole('button', { name: vi_('exportConfirm') }));
const option = (label: Parameters<typeof translate>[1]) => screen.getByRole('radio', { name: vi_(label) });

describe('TripScheduleExportButton', () => {
  beforeEach(() => {
    fetchTripExportSnapshot.mockReset().mockResolvedValue({ items: [{ id: 't1' }], readAt: READ_AT });
    downloadTripScheduleWorkbook.mockReset().mockResolvedValue(1);
    useSession.mockReset().mockReturnValue(session(HEAD));
    notifySuccess.mockReset();
    notifyError.mockReset();
    notifyApiError.mockReset();
  });

  it('★ opens a dialog and reads nothing until "Xuất file" is pressed', () => {
    renderButton();

    openDialog();

    expect(fetchTripExportSnapshot).not.toHaveBeenCalled();
    expect(downloadTripScheduleWorkbook).not.toHaveBeenCalled();
  });

  it('★ restates the pickup range as dd/mm/yyyy, the customers, and what is never included', () => {
    renderButton();

    const dialog = within(openDialog());

    expect(dialog.getByText('02/11/2026 – 08/11/2026')).toBeInTheDocument();
    expect(dialog.getByText(vi_('exportAllCustomers'))).toBeInTheDocument();
    expect(dialog.getByText(vi_('exportExcludesArchived'))).toBeInTheDocument();
  });

  it('★ restates the APPLIED customer search, and sends exactly that', async () => {
    renderButton('operational', 'viễn');

    const dialog = within(openDialog());
    expect(dialog.getByText(`${vi_('exportCustomerContains')} “viễn”`)).toBeInTheDocument();
    exportFile();

    await waitFor(() =>
      expect(fetchTripExportSnapshot).toHaveBeenCalledWith({ ...RANGE, customer: 'viễn', scope: 'operational' }),
    );
  });

  /**
   * ★ THIS SCREEN IS THE DEFAULT, BOTH ARE A CHOICE. A file holding another
   * screen's rows must be something the person picked by name — never what a
   * click on the familiar button means by itself.
   */
  it.each([
    ['Lịch xe', 'operational', 'exportScopeOperational'],
    ['Lịch sử chuyến', 'history', 'exportScopeHistory'],
  ] as const)('★ on %s, opens on that screen only, with "both" offered beside it', async (_screen, lifecycle, label) => {
    renderButton(lifecycle);
    openDialog();

    expect(option(label)).toBeChecked();
    expect(option('exportScopeAll')).not.toBeChecked();
    expect(screen.getAllByRole('radio')).toHaveLength(2);

    exportFile();
    await waitFor(() =>
      expect(fetchTripExportSnapshot).toHaveBeenCalledWith({ ...RANGE, customer: '', scope: lifecycle }),
    );
    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(expect.objectContaining({ scope: lifecycle })),
    );
  });

  it('★ exports both screens in one file only when that is chosen', async () => {
    renderButton();
    openDialog();

    fireEvent.click(option('exportScopeAll'));
    exportFile();

    await waitFor(() =>
      expect(fetchTripExportSnapshot).toHaveBeenCalledWith({ ...RANGE, customer: '', scope: 'all' }),
    );
    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(
        expect.objectContaining({ scope: 'all', readAt: READ_AT, range: RANGE, customer: '', trips: [{ id: 't1' }] }),
      ),
    );
  });

  /**
   * ★ THE CORE PROMISE: same range, same applied search, same data — the
   * combined file is the same whichever screen it was asked from. Nothing
   * about the screen reaches the request or the builder once "both" is chosen.
   */
  it('★ asks for — and builds — the identical combined file from Lịch xe and from Lịch sử chuyến', async () => {
    const exportBothFrom = async (lifecycle: 'operational' | 'history') => {
      fetchTripExportSnapshot.mockClear();
      downloadTripScheduleWorkbook.mockClear();
      const view = renderButton(lifecycle, 'An Phát');
      openDialog();
      fireEvent.click(option('exportScopeAll'));
      exportFile();
      await waitFor(() => expect(downloadTripScheduleWorkbook).toHaveBeenCalledTimes(1));
      const { t: _t, ...built } = downloadTripScheduleWorkbook.mock.calls[0]![0] as Record<string, unknown>;
      const asked = fetchTripExportSnapshot.mock.calls[0]![0];
      view.unmount();
      return { asked, built };
    };

    const fromSchedule = await exportBothFrom('operational');
    const fromHistory = await exportBothFrom('history');

    expect(fromSchedule.asked).toEqual({ ...RANGE, customer: 'An Phát', scope: 'all' });
    expect(fromHistory.asked).toEqual(fromSchedule.asked);
    expect(fromHistory.built).toEqual(fromSchedule.built);
  });

  it('opens on this screen again every time — the last choice is not remembered', async () => {
    renderButton();
    openDialog();
    fireEvent.click(option('exportScopeAll'));
    fireEvent.click(screen.getByRole('button', { name: vi_('cancel') }));

    openDialog();

    expect(option('exportScopeOperational')).toBeChecked();
  });

  it('closes on "Hủy" without reading anything', () => {
    renderButton();
    openDialog();

    fireEvent.click(screen.getByRole('button', { name: vi_('cancel') }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchTripExportSnapshot).not.toHaveBeenCalled();
  });

  it('says how many trips went out, closes, and only then — after the file was written', async () => {
    downloadTripScheduleWorkbook.mockResolvedValue(2);
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() => expect(notifySuccess).toHaveBeenCalledWith('exportDone', { description: `2 ${vi_('exportRowsUnit')}` }));
    expect(downloadTripScheduleWorkbook).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  /**
   * ★ THE COST BLOCK FOLLOWS `cost.export`, THE PRICES `trip.price.read`. The
   * server enforces both on the data; the session decides the layout.
   */
  it.each([
    ['the SuperAdmin (both keys)', [...HEAD, 'cost.read', 'cost.export'], true, true],
    ['accounting (cost.export, no cost.read)', [...HEAD, 'cost.export'], true, true],
    ['the board’s key alone (cost.read)', [...HEAD, 'cost.read'], true, false],
    ['sales / dispatch / customer service', ['trip.read'], false, false],
  ] as const)('★ asks for the money its viewer may take out — %s', async (_who, permissions, includePrices, includeCosts) => {
    useSession.mockReturnValue(session([...permissions]));
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() =>
      expect(downloadTripScheduleWorkbook).toHaveBeenCalledWith(expect.objectContaining({ includePrices, includeCosts })),
    );
  });

  /**
   * ★ NO FILE FOR AN EMPTY RANGE. A workbook holding a heading row and nothing
   * under it is indistinguishable from a broken export.
   */
  it('★ says so instead of writing an empty workbook', async () => {
    fetchTripExportSnapshot.mockResolvedValue({ items: [], readAt: READ_AT });
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('exportEmpty'));
    expect(downloadTripScheduleWorkbook).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('★ a failed read writes no file, says no success, and leaves the dialog open to retry', async () => {
    fetchTripExportSnapshot.mockRejectedValue(new Error('The export answer carried no snapshot.'));
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() => expect(notifyApiError).toHaveBeenCalledWith(expect.anything(), 'exportFailed'));
    expect(downloadTripScheduleWorkbook).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: vi_('exportConfirm') })).not.toBeDisabled();
  });

  it('★ a file that fails to write is an error — never a success', async () => {
    downloadTripScheduleWorkbook.mockRejectedValue(new Error('writeFile failed'));
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() => expect(notifyApiError).toHaveBeenCalledWith(expect.anything(), 'exportFailed'));
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  /**
   * ★ THE SERVER'S TWO REFUSALS ARE SAID IN THE OFFICE'S WORDS — never its
   * English sentence — and neither leaves a file behind.
   */
  it('★ says two exports are already running when the server is busy — no file', async () => {
    fetchTripExportSnapshot.mockRejectedValue(new ApiError(429, 'EXPORT_BUSY', 'Two Excel exports are already running.', undefined, 30));
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() => expect(notifyError).toHaveBeenCalledWith('exportBusy'));
    expect(notifyApiError).not.toHaveBeenCalled();
    expect(downloadTripScheduleWorkbook).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('★ says how many trips the range holds and the most one file takes — refused whole, no file', async () => {
    fetchTripExportSnapshot.mockRejectedValue(
      new ApiError(422, 'EXPORT_TOO_LARGE', 'Too many.', { trips: '21900', limit: '20000' }),
    );
    renderButton();
    openDialog();

    exportFile();

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith('exportTooLarge', {
        description: `21900 ${vi_('exportTooLargeCounts')} 20000 ${vi_('exportTooLargeHint')}`,
      }),
    );
    expect(downloadTripScheduleWorkbook).not.toHaveBeenCalled();
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('cannot be pressed twice while it is running, nor closed under it', async () => {
    let release: (snapshot: unknown) => void = () => {};
    fetchTripExportSnapshot.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderButton();
    openDialog();

    exportFile();
    const running = await screen.findByRole('button', { name: vi_('exportRunning') });
    expect(running).toBeDisabled();
    expect(screen.getByRole('button', { name: vi_('cancel') })).toBeDisabled();
    fireEvent.click(running);
    expect(fetchTripExportSnapshot).toHaveBeenCalledTimes(1);

    release({ items: [{ id: 't1' }], readAt: READ_AT });
    await waitFor(() => expect(notifySuccess).toHaveBeenCalled());
  });
});
