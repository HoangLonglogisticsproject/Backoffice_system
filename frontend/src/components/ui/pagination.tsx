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
          <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
        )}
      </div>
    </div>
  );
}

function PageSizeSelect({
  pageSize,
  onPageSizeChange,
}: Readonly<{ pageSize: number; onPageSizeChange: (size: number) => void }>) {
  const { t } = useLanguage();

  return (
    <Select value={pageSize.toString()} onValueChange={(value) => onPageSizeChange(Number(value))}>
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
  );
}

interface OffsetPaginationProps {
  page: number;
  totalPages: number;
  /** Rows in the whole filtered range — the number keyset lists cannot produce. */
  total: number;
  onGoToPage: (page: number) => void;
  onNext: () => void;
  onPrevious: () => void;
  pageSize: number;
  onPageSizeChange?: (size: number) => void;
  isLoading?: boolean;
  className?: string;
}

/**
 * Page controls for the ONE offset-paginated list: the trip schedule.
 *
 * ★ IT SITS BESIDE `CursorPagination`, IT DOES NOT REPLACE IT. Everything the
 * comment above says about keyset lists is still true of them — they have no
 * total, so they cannot show "page 7 of 26" honestly. This component can only
 * exist because `GET /trip-schedules` bounds its result set by a mandatory date
 * range, which is what makes a `COUNT(*)` affordable (ADR-0003).
 *
 * If you are reaching for this on a new list, check whether that list has such
 * a bound. Almost none do.
 */
export function OffsetPagination({
  page,
  totalPages,
  total,
  onGoToPage,
  onNext,
  onPrevious,
  pageSize,
  onPageSizeChange,
  isLoading = false,
  className,
}: Readonly<OffsetPaginationProps>) {
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
          <span>{`${t('totalRows')}: ${total}`}</span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-gray-600"
          onClick={onPrevious}
          disabled={page <= 1 || isLoading}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">{t('previousPage')}</span>
        </Button>

        <PageNumbers
          page={page}
          totalPages={totalPages}
          onGoToPage={onGoToPage}
          isLoading={isLoading}
        />

        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1 text-gray-600"
          onClick={onNext}
          disabled={page >= totalPages || isLoading}
        >
          <span className="hidden sm:inline">{t('nextPage')}</span>
          <ChevronRight className="h-4 w-4" />
        </Button>

        {onPageSizeChange && (
          <PageSizeSelect pageSize={pageSize} onPageSizeChange={onPageSizeChange} />
        )}
      </div>
    </div>
  );
}

/** How many numbered buttons to render around the current page. */
const WINDOW = 5;

/**
 * A short window of page buttons, plus the current position in words.
 *
 * Every page of a long list is not worth rendering — a year of dispatch at 10
 * rows a page is 100 buttons — so this shows a window around the current page
 * and states "Trang 7 / 26" beside it, which is the part somebody actually
 * reads.
 */
function PageNumbers({
  page,
  totalPages,
  onGoToPage,
  isLoading,
}: Readonly<{
  page: number;
  totalPages: number;
  onGoToPage: (page: number) => void;
  isLoading: boolean;
}>) {
  const { t } = useLanguage();

  // Nothing loaded, or a single page: numbers would be one disabled button.
  if (totalPages <= 1) {
    return <span className="px-2 text-sm text-gray-500">{`${t('page')} 1 / ${Math.max(totalPages, 1)}`}</span>;
  }

  const half = Math.floor(WINDOW / 2);
  const start = Math.max(1, Math.min(page - half, totalPages - WINDOW + 1));
  const end = Math.min(totalPages, start + WINDOW - 1);
  const numbers = Array.from({ length: end - start + 1 }, (_, index) => start + index);

  return (
    <div className="flex items-center gap-1">
      <span className="hidden px-1 text-sm text-gray-500 md:inline">
        {`${t('page')} ${page} / ${totalPages}`}
      </span>
      {numbers.map((number) => (
        <Button
          key={number}
          variant={number === page ? 'default' : 'outline'}
          size="sm"
          aria-current={number === page ? 'page' : undefined}
          className={cn('h-8 w-8 p-0 text-sm', number === page && 'bg-blue-600 text-white')}
          onClick={() => onGoToPage(number)}
          disabled={isLoading}
        >
          {number}
        </Button>
      ))}
    </div>
  );
}
