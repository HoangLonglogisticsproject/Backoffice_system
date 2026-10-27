import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LanguageProvider } from '@/contexts/LanguageContext';
import { PushToggle } from './PushToggle';

/**
 * Ô bật/tắt thông báo đẩy trên trang thông báo của tài xế.
 *
 * ★ CÁC CASE Ở ĐÂY NÓI VỀ ĐIỀU NGƯỜI DÙNG NHÌN THẤY KHI KHÔNG BẬT ĐƯỢC. Một
 * cái nút nằm đó cho người ta bấm mãi, trong khi nguyên nhân là quyền đã bị
 * chặn ở cài đặt trình duyệt, là cách tệ nhất để hỏng — nên mỗi trạng thái
 * không-sửa-được-bằng-cách-bấm phải CẤT NÚT ĐI và nói rõ phải làm gì.
 */
const hooks = vi.hoisted(() => ({
  state: { current: 'off' as string },
  enable: vi.fn(async () => undefined),
  disable: vi.fn(async () => undefined),
  busy: { current: false },
  error: { current: null as string | null },
}));

vi.mock('@/hooks/usePushNotifications', () => ({
  usePushNotifications: () => ({
    state: hooks.state.current,
    busy: hooks.busy.current,
    error: hooks.error.current,
    enable: hooks.enable,
    disable: hooks.disable,
  }),
}));

const draw = () =>
  render(
    <LanguageProvider>
      <PushToggle />
    </LanguageProvider>,
  );

describe('PushToggle', () => {
  beforeEach(() => {
    hooks.state.current = 'off';
    hooks.busy.current = false;
    hooks.error.current = null;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('★ trong lúc còn đang kiểm tra thì không vẽ gì — không nhấp nháy một nút sai', () => {
    hooks.state.current = 'checking';
    const { container } = draw();

    expect(container).toBeEmptyDOMElement();
  });

  it('đang tắt: mời bật', async () => {
    draw();

    const button = screen.getByRole('button', { name: 'Bật thông báo' });
    fireEvent.click(button);

    expect(hooks.enable).toHaveBeenCalledTimes(1);
  });

  it('đang bật: mời tắt', async () => {
    hooks.state.current = 'on';
    draw();

    expect(screen.getByText('Đang bật trên máy này')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tắt thông báo' }));

    expect(hooks.disable).toHaveBeenCalledTimes(1);
  });

  it('★ quyền đã bị chặn: không có nút nào, và câu chữ chỉ sang cài đặt trình duyệt', () => {
    hooks.state.current = 'denied';
    draw();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toContain('cài đặt trình duyệt');
  });

  it('★ trình duyệt không hỗ trợ: không có nút nào, và câu chữ nói phải làm gì thay thế', () => {
    hooks.state.current = 'unsupported';
    draw();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toContain('màn hình chính');
  });

  it('bản build chưa cấu hình cũng không mời bấm', () => {
    hooks.state.current = 'unconfigured';
    draw();

    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('đang xử lý thì nút bị khoá, nên không gọi hai lần', async () => {
    hooks.busy.current = true;
    draw();

    const button = screen.getByRole('button');
    expect(button).toBeDisabled();
    await waitFor(() => expect(hooks.enable).not.toHaveBeenCalled());
  });

  it('lần thử vừa rồi hỏng: nói bằng một câu người dùng hiểu, không phải bằng lỗi kỹ thuật', () => {
    hooks.error.current = 'AbortError: registration failed';
    draw();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Chưa bật được thông báo');
    expect(alert.textContent).not.toContain('AbortError');
  });
});
