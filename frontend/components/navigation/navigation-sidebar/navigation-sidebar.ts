import { Overlay, OverlayRef } from '@angular/cdk/overlay';
import { TemplatePortal } from '@angular/cdk/portal';
import { CdkScrollable, ViewportRuler } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  TemplateRef,
  ViewContainerRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { filter } from 'rxjs';
import { Icon } from '../../ui/icon/icon';
import { accentVars } from '@bo/utils';
import { NavBrand, NavExpansion, NavGroup, NavigationModel } from '../navigation.model';

/**
 * Navigation is assembled from data only: tenant-declared fixed items plus the
 * departments this persona may enter, each expanded with the capability
 * presentations registered for that persona. There is no list of department
 * names anywhere in this file — that is the whole point.
 *
 * One component, three presentations, driven by the shell:
 *   sidebar  — full width, labels and groups visible
 *   rail     — the same rows with the label column collapsed away
 *   drawer   — off-canvas on compact viewports
 *
 * ANATOMY
 * Every destination in every presentation is one primitive:
 *
 *   a.nav__row              hit target and grid. Never painted when active.
 *     span.nav__slot        the shape: 28px in the sidebar, 40px in the rail.
 *       bo-icon             Present at every size and state; transparent until
 *                           the row is the current page, when it fills. This is
 *                           the whole active treatment — there is deliberately
 *                           no full-width active background anywhere.
 *     span.nav__label       collapsed to an accessible name in the rail
 *     span.nav__count       badge
 *
 * A department is NOT that primitive with a chevron bolted on: it is a
 * disclosure that owns a gutter and a list, so it gets its own header, its own
 * always-tinted accent tile, and a spine its children hang from.
 */
@Component({
  selector: 'bo-navigation-sidebar',
  imports: [Icon, RouterLink, RouterLinkActive],
  // The rail is the scrolling container, and CDK's scroll dispatcher only
  // tracks elements it has been told about — without this the tooltip does not
  // follow its anchor when the navigation itself scrolls.
  hostDirectives: [CdkScrollable],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.rail]': 'rail()', '[class.open]': 'open()' },
  template: `
    <!-- Chrome, not navigation: its own surface above the tinted nav field. -->
    <a class="brand" routerLink="/" [attr.aria-label]="brand().name">
      <span class="brand__mark" [style]="brandVars()">{{ brand().monogram }}</span>
      <span class="brand__name">{{ brand().name }}</span>
    </a>

    <nav class="nav" aria-label="Điều hướng chính" (keydown)="onKeydown($event)">
      @if (model().primary.length) {
        <!--
          Decorative headings for the eye only — the list is already labelled
          for a screen reader by the nav's own aria-label, so repeating it here
          would just add noise to the accessibility tree.
        -->
        <p class="nav__section" aria-hidden="true">Chung</p>
      }
      <ul class="nav__list">
        @for (item of model().primary; track item.link) {
          <li>
            <a
              class="nav__row"
              [routerLink]="item.link"
              routerLinkActive=""
              [routerLinkActiveOptions]="exactRoute"
              ariaCurrentWhenActive="page"
              (mouseenter)="showTip($event, item.label)"
              (focus)="showTip($event, item.label)"
              (mouseleave)="hideTip()"
              (blur)="hideTip()"
            >
              <span class="nav__slot">
                <bo-icon
                  [name]="item.icon"
                  [size]="rail() ? 20 : 18"
                  [strokeWidth]="isCurrent(item.link) ? 2.1 : 1.8"
                />
              </span>
              <span class="nav__label">{{ item.label }}</span>
              @if (item.badge) {
                <!--
                  The pulse says "moving now"; the number says "how many are
                  waiting". Two different facts, so two devices — collapsing the
                  count into the dot would read tidier and tell the user less.
                -->
                <span class="nav__pulse" aria-hidden="true"></span>
                <span class="nav__count">{{ item.badge }}</span>
              }
            </a>
          </li>
        }
      </ul>

      @if (model().groups.length) {
        <hr class="nav__rule" />
        <p class="nav__section" aria-hidden="true">{{ model().groupsLabel }}</p>
        <ul class="nav__list">
          @for (group of model().groups; track group.id) {
            <!--
              The accent comes from the department's own domain data and is set
              once here, so the tile, the spine and the active child all read the
              same two custom properties without any component branching on a
              colour name.
            -->
            <li class="dept" [style]="accentFor(group.id)">
              <div class="dept__header">
                <!--
                  The disclosure is a SIBLING of the link and stays after it in
                  the DOM: interactive content inside an anchor is invalid HTML,
                  and keeping the source order means the tab order is still
                  "department, then its toggle". It is only drawn to the left.
                -->
                <a
                  class="nav__row nav__row--dept"
                  [class.nav__row--here]="isInsideGroup(group)"
                  [routerLink]="group.link"
                  routerLinkActive=""
                  [ariaCurrentWhenActive]="isCurrentGroup(group) ? 'page' : undefined"
                  (mouseenter)="showTip($event, group.label)"
                  (focus)="showTip($event, group.label)"
                  (mouseleave)="hideTip()"
                  (blur)="hideTip()"
                >
                  <span class="nav__slot">
                    <bo-icon
                      [name]="group.icon"
                      [size]="rail() ? 20 : 16"
                      [strokeWidth]="isInsideGroup(group) ? 2.1 : 1.8"
                    />
                  </span>
                  <span class="nav__label">{{ group.label }}</span>
                </a>

                @if (group.children.length) {
                  <button
                    class="dept__disclosure"
                    type="button"
                    [attr.aria-expanded]="isExpanded(group)"
                    [attr.aria-controls]="panelId(group.id)"
                    [attr.aria-label]="
                      (isExpanded(group) ? 'Thu gọn ' : 'Mở rộng ') + group.label
                    "
                    (click)="toggle(group)"
                  >
                    <bo-icon
                      [name]="isExpanded(group) ? 'chevron-down' : 'chevron-right'"
                      [size]="13"
                      [strokeWidth]="2.4"
                    />
                  </button>
                }
              </div>

              @if (group.children.length) {
                <!-- Rendered but hidden, so aria-controls always resolves. -->
                <ul
                  class="dept__children"
                  [id]="panelId(group.id)"
                  [hidden]="!isExpanded(group)"
                >
                  @for (child of group.children; track child.link) {
                    <li>
                      <a
                        class="nav__row nav__row--child"
                        [routerLink]="child.link"
                        routerLinkActive=""
                        [routerLinkActiveOptions]="exactRoute"
                        ariaCurrentWhenActive="page"
                      >
                        <bo-icon [name]="child.icon" [size]="15" [strokeWidth]="1.9" />
                        <span class="nav__label">{{ child.label }}</span>
                      </a>
                    </li>
                  }
                </ul>
              }
            </li>
          }
        </ul>
      }

      @if (model().secondary.length) {
        <hr class="nav__rule" />
        <p class="nav__section nav__section--system" aria-hidden="true">{{ model().secondaryLabel }}</p>
        <ul class="nav__list nav__list--system">
          @for (item of model().secondary; track item.link) {
            <li>
              <a
                class="nav__row nav__row--system"
                [routerLink]="item.link"
                routerLinkActive=""
                [routerLinkActiveOptions]="exactRoute"
                ariaCurrentWhenActive="page"
                (mouseenter)="showTip($event, item.label)"
                (focus)="showTip($event, item.label)"
                (mouseleave)="hideTip()"
                (blur)="hideTip()"
              >
                <span class="nav__slot" [class.nav__slot--thinking]="isAutonomous(item)">
                  <!-- System stays 17px in both modes: the tier is quieter than
                       primary, and the rail says so by size as well as position. -->
                  <bo-icon
                    [name]="item.icon"
                    [size]="17"
                    [strokeWidth]="isCurrent(item.link) ? 2.1 : 1.8"
                  />
                </span>
                <span class="nav__label">{{ item.label }}</span>
                @if (item.badge) {
                  <span class="nav__pulse" aria-hidden="true"></span>
                  <span class="nav__count">{{ item.badge }}</span>
                }
              </a>
            </li>
          }
        </ul>
      }
    </nav>

    <footer>
      <p>{{ brand().name }} {{ brand().version }}</p>
      <p>{{ brand().copyright }}</p>
    </footer>

    <!--
      Rail tooltip. Rendered through a CDK overlay so it escapes the rail's own
      scroll container, flips to the other side when it would leave the viewport
      and follows scroll and resize. Driven by focus as well as hover, because a
      title attribute never appears for a keyboard user.

      It stays aria-hidden: the label is already the link's accessible name, so
      announcing it again would be duplication, and the tooltip must never be
      the only place the name exists.
    -->
    <ng-template #tipTemplate>
      <div class="tip" aria-hidden="true">{{ tipLabel() }}</div>
    </ng-template>
  `,
  styleUrl: './navigation-sidebar.scss',
})
export class NavigationSidebar {
  readonly rail = input(false);
  readonly open = input(false);

  /** Everything drawn below. See navigation.model.ts — no business types here. */
  readonly model = input.required<NavigationModel>();
  readonly brand = input.required<NavBrand>();

  /**
   * Which groups the user has explicitly toggled. Held by the caller, not here,
   * so the choice survives this component being re-created — and so the
   * navigation stays a pure function of its inputs.
   */
  readonly expansion = input<NavExpansion>({});
  readonly groupToggled = output<string>();

  protected readonly brandVars = computed(() => accentVars(this.brand().accent));

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly router = inject(Router);

  private readonly overlay = inject(Overlay);
  private readonly viewContainer = inject(ViewContainerRef);
  private readonly tipTemplate = viewChild.required<TemplateRef<unknown>>('tipTemplate');

  protected readonly tipLabel = signal('');
  private tipOverlay?: OverlayRef;
  private tipAnchor?: HTMLElement;

  /**
   * Every destination is current only for its own URL. Groups are the one
   * exception, handled by `isCurrentGroup` below.
   */
  protected readonly exactRoute = { exact: true };

  /**
   * `accentVars` builds a fresh object per call, and a style binding handed a
   * new reference every change detection re-writes the element each time. The
   * groups only change when the model does, so the map is computed once per
   * that change and the bindings stay reference-stable.
   */
  private readonly groupVars = computed(
    () =>
      new Map<string, Record<string, string>>(
        this.model().groups.map((group) => [group.id, accentVars(group.accent)]),
      ),
  );

  protected accentFor(groupId: string): Record<string, string> | null {
    return this.groupVars().get(groupId) ?? null;
  }

  constructor() {
    /*
     * `routerLinkActive` keeps its class in sync by writing to the element
     * directly, which never re-runs our own bindings — so on a full page load
     * `aria-current` stayed at whatever it was when the view was first drawn.
     * One explicit refresh per navigation fixes it for every binding here.
     */
    const changes = inject(ChangeDetectorRef);
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => changes.markForCheck());

    // Leaving rail mode with a tooltip open would strand it on screen.
    effect(() => {
      if (!this.rail()) this.hideTip();
    });

    inject(ViewportRuler)
      .change(80)
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.repositionTip());

    inject(DestroyRef).onDestroy(() => this.tipOverlay?.dispose());
  }

  /**
   * When the children are on screen the matching child carries the marker. When
   * they are not — collapsed group, or rail mode where every child is hidden —
   * nothing would be marked at all, so the group link stands in for the page
   * inside it.
   */
  protected isCurrentGroup(group: NavGroup): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    if (path === group.link) return true;

    const childrenVisible = !this.rail() && this.isExpanded(group);
    return !childrenVisible && path.startsWith(group.link + '/');
  }

  /**
   * Whether the current page lives anywhere in this department — including in a
   * child that is carrying the marker itself. Deliberately NOT `isCurrentGroup`:
   * that one steps aside once the children are visible, because only one element
   * may be `aria-current`. The tile is emphasis, not a current marker, so it has
   * to stay lit while a child is the current page.
   */
  protected isInsideGroup(group: NavGroup): boolean {
    const path = this.router.url.split(/[?#]/)[0];
    return path === group.link || path.startsWith(group.link + '/');
  }

  /**
   * Drives stroke weight only. Selection shifts an icon from 1.8 to 2.1 rather
   * than growing it, so the rail's rhythm never moves — `routerLinkActive`
   * cannot do this because it writes a class, and stroke-width is an attribute
   * on the SVG itself.
   */
  protected isCurrent(link: string): boolean {
    return this.router.url.split(/[?#]/)[0] === link;
  }

  /**
   * Destinations where the platform is working on its own behalf rather than
   * waiting for input — the AI coordinator today. They carry a shimmer that
   * crosses the glyph about four times a minute: present enough to say the
   * system is thinking, quiet enough that nobody watching the screen all day
   * ever has to look at it.
   *
   * ponytail: keyed off the icon name, which is the only signal the shell has
   * today. Promote to an explicit `autonomous?: boolean` on ShellNavItem when a
   * second such destination appears — the nav model is a tenant contract and
   * not worth widening for one entry.
   */
  protected isAutonomous(item: { icon: string }): boolean {
    return item.icon === 'sparkles';
  }

  protected panelId(groupId: string): string {
    return `nav-group-${groupId}`;
  }

  protected isExpanded(group: NavGroup): boolean {
    return this.expansion()[group.id] ?? group.expandedByDefault;
  }

  protected toggle(group: NavGroup): void {
    this.groupToggled.emit(group.id);
  }

  protected showTip(event: Event, label: string): void {
    if (!this.rail()) return;
    this.tipLabel.set(label);
    this.tipAnchor = event.currentTarget as HTMLElement;

    // Right of the icon; if that would run off-screen, the same distance to the
    // left. `withPush` then nudges it back inside near the top and bottom edges.
    const position = this.overlay
      .position()
      .flexibleConnectedTo(this.tipAnchor)
      .withPositions([
        { originX: 'end', originY: 'center', overlayX: 'start', overlayY: 'center', offsetX: 8 },
        { originX: 'start', originY: 'center', overlayX: 'end', overlayY: 'center', offsetX: -8 },
      ])
      .withPush(true);

    if (!this.tipOverlay) {
      this.tipOverlay = this.overlay.create({
        positionStrategy: position,
        // Follows the anchor while the rail scrolls, and gives up rather than
        // pointing at an item that has scrolled out of sight.
        scrollStrategy: this.overlay.scrollStrategies.reposition({ autoClose: true }),
        disposeOnNavigation: true,
      });
    } else {
      this.tipOverlay.updatePositionStrategy(position);
    }

    if (!this.tipOverlay.hasAttached()) {
      this.tipOverlay.attach(new TemplatePortal(this.tipTemplate(), this.viewContainer));
    }
    this.tipOverlay.updatePosition();
  }

  protected hideTip(): void {
    this.tipOverlay?.detach();
    this.tipAnchor = undefined;
  }

  /**
   * A resize can move the anchor anywhere, including off screen entirely, where
   * no position is meaningful. Re-aim at it while it is visible; dismiss once it
   * is not.
   */
  private repositionTip(): void {
    if (!this.tipOverlay?.hasAttached()) return;
    const box = this.tipAnchor?.getBoundingClientRect();
    const onScreen = box && box.bottom > 0 && box.top < window.innerHeight;
    onScreen ? this.tipOverlay.updatePosition() : this.hideTip();
  }

  /**
   * Arrow keys move between destinations, so crossing the navigation does not
   * cost one Tab press per module. Tab still works exactly as it did — this is
   * an addition, not a replacement, which is why every destination keeps its
   * natural tab stop rather than adopting a roving tabindex.
   *
   * One selector now covers every tier, because every tier is the same row.
   */
  protected onKeydown(event: KeyboardEvent): void {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;

    const items = Array.from(
      this.host.nativeElement.querySelectorAll<HTMLElement>('.nav__row'),
    ).filter((el) => el.offsetParent !== null);
    if (!items.length) return;

    const current = items.indexOf(document.activeElement as HTMLElement);
    let next: number;
    switch (event.key) {
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      case 'ArrowDown':
        next = current < 0 ? 0 : Math.min(current + 1, items.length - 1);
        break;
      default:
        next = current < 0 ? items.length - 1 : Math.max(current - 1, 0);
    }

    event.preventDefault();
    items[next].focus();
  }
}
