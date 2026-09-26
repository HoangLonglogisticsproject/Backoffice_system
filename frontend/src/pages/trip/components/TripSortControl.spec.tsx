import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { DEFAULT_TRIP_BOARD_ORDER, type TripBoardOrder } from '@/types/tripBoard';
import { TripSortControl } from './TripSortControl';

const renderControl = (value: TripBoardOrder = DEFAULT_TRIP_BOARD_ORDER) => {
  const onChange = vi.fn();
  render(
    <LanguageProvider>
      <TripSortControl value={value} onChange={onChange} />
    </LanguageProvider>,
  );
  return onChange;
};

describe('TripSortControl', () => {
  it('offers the three orders by the words the business uses, the current one selected', () => {
    renderControl({ sort: 'bookingCreated', direction: 'asc' });

    const field = screen.getByLabelText('Sắp xếp theo');
    // "Chỉnh sửa", never "Cập nhật": the key is the trip row's own `updated_at`,
    // which a new crew, a cost line or a driver milestone does not move.
    expect(
      Array.from((field as HTMLSelectElement).options).map((option) => option.textContent),
    ).toEqual(['Ngày chạy', 'Booking mới nhất', 'Chỉnh sửa gần nhất']);
    expect(field).toHaveValue('bookingCreated');
    expect(screen.getByLabelText('Thứ tự')).toHaveValue('asc');
  });

  it('changes the key and keeps the direction', () => {
    const onChange = renderControl();

    fireEvent.change(screen.getByLabelText('Sắp xếp theo'), { target: { value: 'lastUpdated' } });

    expect(onChange).toHaveBeenCalledWith({ sort: 'lastUpdated', direction: 'desc' });
  });

  it('changes the direction and keeps the key', () => {
    const onChange = renderControl();

    fireEvent.change(screen.getByLabelText('Thứ tự'), { target: { value: 'asc' } });

    expect(onChange).toHaveBeenCalledWith({ sort: 'executionDate', direction: 'asc' });
  });
});
