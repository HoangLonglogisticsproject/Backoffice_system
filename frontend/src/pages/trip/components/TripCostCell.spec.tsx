import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { LanguageProvider } from '@/contexts/LanguageContext';
import type { TripCostSummary } from '@/types/tripBoard';
import { TripCostCell } from './TripCostCell';

const renderCell = (summary: TripCostSummary | null | undefined, onOpen = vi.fn()) => {
  render(
    <LanguageProvider>
      <TripCostCell summary={summary} onOpen={onOpen} />
    </LanguageProvider>,
  );
  return onOpen;
};

/**
 * ★ ZERO AND UNKNOWN ARE DIFFERENT ANSWERS. A dash says "not known here"; "Chưa
 * có" says the server counted and found nothing. Drawing either as the other
 * is a claim about money that is not true.
 */
describe('TripCostCell', () => {
  it.each([null, undefined])('★ shows a dash, never a zero, when there is no summary (%s)', (summary) => {
    renderCell(summary);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Không rõ chi phí')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
    expect(document.body.textContent).not.toMatch(/0/);
  });

  it('says "none yet" for a counted zero, and still opens the dialog to add one', () => {
    const onOpen = renderCell({ total: '0.00', itemCount: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'Chi phí chuyến: Chưa có' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('formats the server total without re-adding anything, with its line count', () => {
    renderCell({ total: '6250000.50', itemCount: 3 });

    const cell = screen.getByRole('button', { name: 'Chi phí chuyến: 6,250,000.50' });
    expect(cell).toHaveTextContent('3 khoản');
  });

  it('drops a zero fraction, as every other amount on the board does', () => {
    renderCell({ total: '1500000.00', itemCount: 1 });

    expect(screen.getByRole('button').textContent).not.toContain('.00');
  });
});
