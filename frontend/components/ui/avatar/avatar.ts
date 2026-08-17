import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Photo when there is one, deterministic initials when there is not. */
@Component({
  selector: 'bo-avatar',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--size.px]': 'size()', '[style.--hue]': 'hue()' },
  template: `
    <!-- Guarded: with no photo the initials render instead, so the tag never ships empty. -->
    @if (src(); as photo) {
      <img [src]="photo" [alt]="name()" />
    } @else {
      <span aria-hidden="true">{{ initials() }}</span>
    }
  `,
  styles: `
    :host {
      display: grid;
      place-items: center;
      flex: none;
      width: var(--size, 24px);
      height: var(--size, 24px);
      border-radius: 50%;
      overflow: hidden;
      background: hsl(var(--hue, 220) 70% 94%);
      color: hsl(var(--hue, 220) 55% 38%);
      font-size: calc(var(--size, 24px) * 0.4);
      font-weight: 600;
      line-height: 1;
      user-select: none;
    }

    img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
  `,
})
export class Avatar {
  readonly name = input.required<string>();
  readonly src = input<string | undefined>(undefined);
  readonly size = input(24);

  protected readonly initials = computed(() =>
    this.name()
      .trim()
      .split(/\s+/)
      .slice(-2)
      .map((part) => part[0] ?? '')
      .join('')
      .toUpperCase(),
  );

  /** Same name always gets the same colour, so people stay recognisable. */
  protected readonly hue = computed(() => {
    const name = this.name();
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 360;
    return hash;
  });
}
