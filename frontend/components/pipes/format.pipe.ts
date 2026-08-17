import { InjectionToken, Pipe, PipeTransform, Provider, inject } from '@angular/core';

/**
 * Display formatting.
 *
 * ponytail: three tiny pipes over `Intl` instead of a date library.
 *
 * The locale and currency are CONFIGURATION, not constants. They used to be
 * `vi-VN` and `VND` written into this file, which meant the foundation could
 * only ever ship to one country — a customer outside Vietnam had to fork a
 * library to show their own money.
 *
 * This is not an i18n system and is not trying to be one. It is the smallest
 * thing that stops the foundation being locked to one customer's locale.
 */
export interface FormatConfig {
  /** BCP 47 tag, e.g. 'vi-VN', 'en-US'. */
  locale: string;
  /** ISO 4217 code, e.g. 'VND', 'USD'. */
  currency: string;
  /** Shown by `boRelativeTime` for anything under a minute old. */
  justNow: string;
  /** Shown by every pipe for null, undefined and unparseable input. */
  blank: string;
}

/**
 * Neutral default so `libs/` renders and tests on its own, with no application
 * present. A customer application overrides it with `provideFormatting`.
 */
export const FORMAT_CONFIG = new InjectionToken<FormatConfig>('FORMAT_CONFIG', {
  providedIn: 'root',
  factory: (): FormatConfig => ({
    locale: 'en-US',
    currency: 'USD',
    justNow: 'just now',
    blank: '—',
  }),
});

/** Composition-root helper: `provideFormatting({ locale: 'vi-VN', … })`. */
export function provideFormatting(config: Partial<FormatConfig>): Provider {
  return {
    provide: FORMAT_CONFIG,
    useFactory: (): FormatConfig => ({
      locale: 'en-US',
      currency: 'USD',
      justNow: 'just now',
      blank: '—',
      ...config,
    }),
  };
}

@Pipe({ name: 'boDateTime' })
export class DateTimePipe implements PipeTransform {
  private readonly config = inject(FORMAT_CONFIG);
  private readonly format = new Intl.DateTimeFormat(this.config.locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  transform(value: string | Date | null | undefined): string {
    if (!value) return this.config.blank;
    const date = new Date(value);
    return isNaN(date.getTime()) ? this.config.blank : this.format.format(date).replace(',', '');
  }
}

const UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 31_536_000_000],
  ['month', 2_592_000_000],
  ['day', 86_400_000],
  ['hour', 3_600_000],
  ['minute', 60_000],
];

@Pipe({ name: 'boRelativeTime' })
export class RelativeTimePipe implements PipeTransform {
  private readonly config = inject(FORMAT_CONFIG);
  private readonly format = new Intl.RelativeTimeFormat(this.config.locale, { numeric: 'auto' });

  transform(value: string | Date | null | undefined): string {
    if (!value) return this.config.blank;
    const diff = new Date(value).getTime() - Date.now();
    if (isNaN(diff)) return this.config.blank;
    for (const [unit, ms] of UNITS) {
      if (Math.abs(diff) >= ms) return this.format.format(Math.round(diff / ms), unit);
    }
    return this.config.justNow;
  }
}

@Pipe({ name: 'boMoney' })
export class MoneyPipe implements PipeTransform {
  private readonly config = inject(FORMAT_CONFIG);
  private readonly format = new Intl.NumberFormat(this.config.locale, {
    style: 'currency',
    currency: this.config.currency,
    maximumFractionDigits: 0,
  });

  transform(value: number | null | undefined): string {
    return value == null ? this.config.blank : this.format.format(value);
  }
}
