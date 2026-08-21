import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';
import { cn } from '@/utils/cn';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useLanguage } from '@/contexts/LanguageContext';

interface CursorPaginationProps {
  /** How many rows the current page actually returned. */
  shown: number;
  /** From the response. The only thing that says another page exists. */
  hasMore: boolean;
  /** True when this client has a page to go back to — see `useCursorPages`. */
  canGoBack: boolean;
  onNext: () => void;
  onPrevious: () => void;
  pageSize: number;
  onPageSizeChange?: (size: number) => void;
  isLoading?: boolean;
  className?: string;
}

const PAGE_SIZES = [10, 20, 50, 100];

/**
 * Page controls for a KEYSET-paginated list.
 *
 * ★ THERE ARE NO PAGE NUMBERS, AND THAT IS NOT AN OMISSION. The API answers
 * `{ items, nextCursor, hasMore }` and deliberately returns no total: `hasMore`
 * comes from reading one row beyond the limit, while a count would re-scan the
 * whole table on every page and reintroduce exactly the cost pagination exists
 * to remove. Without a total there is no last page to number, so "page 7 of 26"
 * cannot be rendered honestly — and rendering it dishonestly is worse than not
 * rendering it.
 *
 * So the controls are the ones the contract can actually support: forward, back,
 * page size. `nextCursor` stays opaque; nothing here reads inside it.
 *
 * Going BACK is the client's own memory. Cursors point forward only, so the
 * page holding this component keeps the stack of cursors it has visited — see
 * `useCursorPages`. The server is never asked to walk backwards.
 */
export function CursorPagination({
  shown,
  hasMore,
  canGoBack,
  onNext,
  onPrevious,
  pageSize,
  onPageSizeChange,
  isLoading = false,
  className,
}: Readonly<CursorPaginationProps>) {
  const { t } = useLanguage();

  return (
    <div className={cn('flex flex-wrap items-center justify-between gap-3 px-2 py-3', className)}>
      <div className="flex items-center gap-2 text-sm text-gray-500">
        {isLoading ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            <span>{t('loading')}</span>
          </>
        ) : (
          // A count of what is on screen. Never "of N" — there is no N.
          <span>{`${t('showingRows')}: ${shown}`}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-gray-600"
          onClick={onPrevious}
          disabled={!canGoBack || isLoading}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{t('previousPage')}</span>
        </Button>

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-gray-600"
          onClick={onNext}
          disabled={!hasMore || isLoading}
        >
          <span className="hidden sm:inline">{t('nextPage')}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>

        {onPageSizeChange && (
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger aria-label={t('pageSizeLabel')} className="h-8 w-[110px] text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={size.toString()}>
                  {`${size} / ${t('perPage')}`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    </div>
  );
}
