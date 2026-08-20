import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
}

/**
 * A centred dialog with a scrim, a scrolling body and a pinned footer.
 *
 * Escape closes it and the scrim closes it, because a dialog a keyboard user
 * cannot dismiss is a trap. The body scroll is locked while it is open so the
 * page behind does not move under the overlay.
 */
export function Modal({ isOpen, onClose, title, children, footer, className }: Readonly<ModalProps>) {
  React.useEffect(() => {
    if (!isOpen) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);

    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Scrim. `aria-hidden` because the close affordance it duplicates is the
          button below, which screen readers should reach instead. */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />

      <dialog
        open
        aria-modal="true"
        aria-label={title}
        className={cn(
          'relative z-50 w-full max-w-lg bg-white rounded-xl shadow-xl flex flex-col max-h-[90vh]',
          'animate-in fade-in zoom-in-95 duration-200',
          className,
        )}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          {title && <h2 className="text-lg font-semibold text-gray-900">{title}</h2>}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ml-auto"
          >
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">{children}</div>

        {footer && (
          <div className="px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-xl flex items-center justify-end gap-3">
            {footer}
          </div>
        )}
      </dialog>
    </div>
  );
}
