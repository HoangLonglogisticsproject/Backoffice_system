import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { TripLocationListing } from '@/types/trip';
import { LocationCatalogueTable } from './LocationCatalogueTable';

/**
 * The catalogue's rows.
 *
 * ★ WHAT IS UNDER TEST IS WHETHER OPERATIONS CAN SEE A BROKEN ROW. A place with
 * no coordinates refuses every driver's arrival with DESTINATION_MISSING, and
 * this table is the only screen that lists every place in the deployment. If it
 * does not say which ones are unlocated, nobody finds out until a lorry is at a
 * gate.
 *
 * Rendered directly, with no page and no hooks: these are props in, cells out.
 */

const location = (over: Partial<TripLocationListing> = {}): TripLocationListing => ({
  id: 'l1',
  customerId: 'c1',
  customerName: 'Công ty A',
  name: 'Kho OSC',
  address: 'KCN Sóng Thần, Dĩ An',
  contact: null,
  note: null,
  provinceCode: null,
  province: null,
  districtCode: null,
  district: null,
  wardCode: null,
  ward: null,
  latitude: 10.8,
  longitude: 106.6,
  status: 'active',
  createdBy: 'u9',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
  ...over,
});

const renderTable = (rows: TripLocationListing[], canManage = true) => {
  const onEdit = vi.fn();
  const onArchive = vi.fn();
  render(
    <LanguageProvider>
      <LocationCatalogueTable
        rows={rows}
        canManage={canManage}
        onEdit={onEdit}
        onArchive={onArchive}
      />
    </LanguageProvider>,
  );
  return { onEdit, onArchive };
};

describe('LocationCatalogueTable', () => {
  it('says a located place is located, and offers nothing to fix', () => {
    renderTable([location()]);

    expect(screen.getByText('Đã định vị')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thiết lập vị trí' })).toBeNull();
  });

  it('★ names an unlocated place and offers the action that fixes it', () => {
    const { onEdit } = renderTable([location({ latitude: null, longitude: null })]);

    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Thiết lập vị trí' }));

    // The same dialog the pencil opens, named for the job — so the row that
    // will fail a driver is one click from being fixed.
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 'l1' }));
  });

  it('★ an archived place is archived, not "unlocated"', () => {
    renderTable([location({ status: 'archived', latitude: null, longitude: null })]);

    // `statusOf` checks the status first: a place nobody can pick for a trip
    // has no location problem worth flagging, and two amber warnings competing
    // on one row would train people to read neither.
    expect(screen.getByText('Đã lưu trữ')).toBeInTheDocument();
    expect(screen.queryByText('Chưa định vị')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Thiết lập vị trí' })).toBeNull();
  });

  it('offers no actions at all to somebody who may not manage places', () => {
    renderTable([location({ latitude: null, longitude: null })], false);

    // The status is still READ — knowing a row is broken is not the same as
    // being allowed to change it.
    expect(screen.getByText('Chưa định vị')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Thiết lập vị trí' })).toBeNull();
  });

  describe('★ every header has a cell under it', () => {
    // The regression the file's own comment warns about: a header left behind
    // when its cell was commented out leaves a blank column and shifts every
    // column after it, which is how this table grew empty gaps in the middle.
    it.each([true, false])('with canManage=%s', (canManage) => {
      renderTable([location()], canManage);

      const headers = screen.getAllByRole('columnheader').length;
      const body = screen.getAllByRole('row')[1];
      expect(within(body as HTMLElement).getAllByRole('cell')).toHaveLength(headers);
    });
  });
});
