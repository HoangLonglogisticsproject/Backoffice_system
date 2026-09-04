import { toast } from 'sonner';
import { translate, type Language, type TranslationKey } from '@/types/translate';
import { isApiError } from './errors';

/**
 * The one place a write announces how it went.
 *
 * ★ IT LIVES WITH THE MUTATION, NOT WITH THE BUTTON. Every write in this app
 * goes through a hook, and the hook is the only place that knows what the server
 * said — a component reading `isSuccess` would fire again on every re-render it
 * happens to see that flag in, and four screens calling the same hook would each
 * need their own copy of the same two sentences. Announcing it in
 * `onSuccess`/`onError` means one write, one message, wherever it was triggered
 * from.
 *
 * ★ TAKES A TRANSLATION KEY, NOT A STRING. The interface speaks two languages
 * (§ `types/translate`), and a hardcoded Vietnamese toast on an English screen
 * is exactly the drift that file exists to prevent.
 *
 * ⚠ WHY THE LANGUAGE IS A MODULE VARIABLE AND NOT `useLanguage()`. These
 * messages are raised inside mutation callbacks — `onSuccess` is not a render,
 * so there is no context to read there — and pulling the provider into every
 * hook would make the hooks untestable without one. `LanguageProvider` pushes
 * the active choice in here whenever it changes; nothing else writes it.
 */
let language: Language = 'vi';

/** Called by `LanguageProvider`. The only writer. */
export function setToastLanguage(next: Language): void {
  language = next;
}

/**
 * How long a failure stays on screen.
 *
 * ★ LONGER THAN A SUCCESS, BECAUSE IT ASKS FOR SOMETHING. "Đã lưu" is read in
 * half a glance and the screen behind it already shows the result; "chuyến này
 * vừa được người khác duyệt" has to be read, understood and acted on, sometimes
 * by somebody holding a phone in one hand. The `closeButton` on the `Toaster`
 * lets it go earlier; nothing makes it go sooner on its own.
 */
const ERROR_DURATION_MS = 8000;

/** sonner's own default, named here so `build` has one number to reach for. */
const SUCCESS_DURATION_MS = 4000;

/**
 * How long a toast carrying a button stays.
 *
 * ★ A BUTTON NOBODY CAN REACH IN TIME IS WORSE THAN NO BUTTON. The default four
 * seconds is written for a message you only read; "Hoàn tác" has to be noticed,
 * understood and clicked, and a dispatcher's eyes are on the row that just
 * changed, not on the corner of the screen.
 */
const ACTION_DURATION_MS = 10_000;

/**
 * The three parts of the shape sonner draws: title, the line under it, and the
 * button on the right.
 *
 * ★ THE BUTTON'S LABEL IS A KEY LIKE EVERY OTHER STRING. The `onClick` is a
 * plain callback because only the caller knows what undoing its own write means
 * — this file must never learn about trips or expenses.
 *
 * ⚠ `description` IS THE ONE FREE STRING HERE, and deliberately: what goes in it
 * is DATA (a plate, a driver's name, "Chờ xe → Đang giao"), not interface copy.
 * A sentence belongs in `types/translate` with both languages beside it.
 */
export interface NotifyOptions {
  description?: string;
  action?: { labelKey: TranslationKey; onClick: () => void };
}

/** What sonner is handed, from what the caller asked for. */
function build(options: NotifyOptions | undefined, duration: number) {
  return {
    duration: options?.action ? ACTION_DURATION_MS : duration,
    ...(options?.description ? { description: options.description } : {}),
    ...(options?.action
      ? {
          action: {
            label: translate(language, options.action.labelKey),
            onClick: options.action.onClick,
          },
        }
      : {}),
  };
}

/**
 * The active language, for a caller assembling a `description` out of phrases.
 *
 * Exported because a hook cannot call `useLanguage()` — same reason the module
 * variable above exists. Use it for DATA lines ("Chờ xe → Đang giao"); a whole
 * sentence still belongs in a key of its own.
 */
export function translateNow(key: TranslationKey): string {
  return translate(language, key);
}

/**
 * "It worked" — the whole message.
 *
 * Deliberately short-lived and non-blocking: the screen behind it has already
 * re-read the truth from the server, so this is a receipt, not the result.
 */
export function notifySuccess(key: TranslationKey, options?: NotifyOptions): void {
  toast.success(translate(language, key), build(options, SUCCESS_DURATION_MS));
}

/**
 * "It did not work", in words this app chose.
 *
 * For failures that already have a mapping — `driverErrorKey` for the cab,
 * `reviewErrorKey` for the office. Those two decide WHAT to say about a status
 * code; this only puts it on screen.
 */
export function notifyError(key: TranslationKey, options?: NotifyOptions): void {
  toast.error(translate(language, key), build(options, ERROR_DURATION_MS));
}

/**
 * "It did not work", in the server's own words.
 *
 * ★ ONLY WHEN THE SERVER ACTUALLY SPOKE. A refusal carries a reason this client
 * cannot reconstruct — the account stopped being a driver, the trip closed a
 * minute ago, a colleague got there first — and inventing a sentence over that
 * detail is how a dispatcher ends up retrying something that will never work.
 *
 * ⚠ BUT A STATUS 0 IS NOT THE SERVER TALKING. `client.ts` uses it for a request
 * that never arrived, and its `message` is English scaffolding ("Unexpected
 * error") that no user should ever be shown — those get `fallback`, translated,
 * like every other string in the interface.
 *
 * ⚠ AND THIS IS FOR THE BACKOFFICE ONLY. The Driver Portal never shows a raw
 * API message; `driverErrorKey` exists precisely because those sentences are
 * written for the office and sometimes for a developer.
 */
export function notifyApiError(
  error: unknown,
  fallback: TranslationKey,
  options?: NotifyOptions,
): void {
  const spoken = isApiError(error) && error.status >= 400 && error.message.trim().length > 0;
  toast.error(spoken ? error.message : translate(language, fallback), build(options, ERROR_DURATION_MS));
}
