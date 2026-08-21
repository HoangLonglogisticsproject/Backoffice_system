import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AccountSecurityPage from './AccountSecurityPage';
import { LanguageProvider } from '@/contexts/LanguageContext';

const changePassword = vi.fn();

vi.mock('@/api/auth', () => ({
  changePassword: (...args: unknown[]) => changePassword(...args),
}));

vi.mock('@/contexts/SessionProvider', () => ({
  useSession: () => ({ signOut: vi.fn() }),
}));

/**
 * A security screen that lies is worse than one that is missing.
 *
 * Four of the five tabs have no endpoint behind them. They are kept — the
 * structure is product material and the features are coming — but they must
 * render an honest empty state. A mock device list or a 2FA toggle that appears
 * to arm would tell somebody they are protected when they are not, which is the
 * one failure mode a security page cannot have.
 */
const renderPage = () =>
  render(
    <MemoryRouter>
      <LanguageProvider>
        <AccountSecurityPage />
      </LanguageProvider>
    </MemoryRouter>,
  );

describe('AccountSecurityPage', () => {
  it('keeps all five tabs from the design', () => {
    renderPage();

    for (const label of [/change password|đổi mật khẩu/i, /two-factor|hai lớp|2fa/i, /session|phiên/i, /history|lịch sử/i, /device|thiết bị/i]) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('opens on the one tab that is actually wired', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/change password|đổi mật khẩu/i);
    expect(screen.getByLabelText('Mật khẩu hiện tại *')).toBeInTheDocument();
  });

  it.each([
    ['two-factor', /two-factor|hai lớp|2fa/i],
    ['sessions', /session|phiên/i],
    ['login history', /history|lịch sử/i],
    ['devices', /device|thiết bị/i],
  ])('shows %s as unavailable rather than faking it', (_label, pattern) => {
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: pattern }));

    // The honest state: named, present, and explicitly not ready.
    expect(screen.getByText(/not supported yet|chưa được hỗ trợ/i)).toBeInTheDocument();
    // And no controls that imply the feature works.
    expect(screen.queryByRole('switch')).not.toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('refuses to submit when the confirmation does not match', () => {
    renderPage();

    // Exact labels: "mật khẩu mới" is a substring of the CONFIRM label, so a
    // loose match would find two fields and fail on the ambiguity.
    fireEvent.change(screen.getByLabelText('Mật khẩu hiện tại *'), {
      target: { value: 'old passphrase' },
    });
    fireEvent.change(screen.getByLabelText('Mật khẩu mới *'), {
      target: { value: 'a new passphrase' },
    });
    fireEvent.change(screen.getByLabelText('Xác nhận mật khẩu mới *'), {
      target: { value: 'a different one' },
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(changePassword).not.toHaveBeenCalled();
  });
});
