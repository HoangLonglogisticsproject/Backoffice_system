import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { accentVars } from '@bo/utils';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

const TONE_ACCENT: Record<BadgeTone, string> = {
  neutral: 'slate',
  info: 'blue',
  success: 'green',
  warning: 'amber',
  danger: 'rose',
};

/**
 * Status pill. Takes a tone, never a business status — mapping a domain status
 * to a tone is the calling feature's job, so the ui-kit stays tenant-neutral.
 */
@Component({
  selector: 'bo-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style]': 'vars()', '[class.dot]': 'dot()' },
  template: `<ng-content />`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 2px 9px;
      border-radius: var(--r-full);
      background: var(--accent-soft);
      color: var(--accent);
      font-size: var(--t-sm);
      font-weight: 500;
      line-height: 1.5;
      white-space: nowrap;
    }

    :host(.dot)::before {
      content: '';
      flex: none;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
      /* Halo keeps the dot legible against its own tinted pill. */
      box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 18%, transparent);
    }
  `,
})
export class Badge {
  readonly tone = input<BadgeTone>('neutral');
  readonly dot = input(false);

  protected readonly vars = computed(() => accentVars(TONE_ACCENT[this.tone()]));
}
