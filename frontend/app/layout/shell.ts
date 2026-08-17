import { CdkTrapFocus } from '@angular/cdk/a11y';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { NavigationSidebar } from '@bo/components';
import { BRANDING } from '@bo/services';
import { NavigationService } from '../navigation/navigation.service';
import { Topbar } from './topbar';
import { Viewport } from './viewport';

/** Application chrome: sidebar, topbar, routed content. */
@Component({
  selector: 'bo-shell',
  imports: [RouterOutlet, NavigationSidebar, Topbar, CdkTrapFocus],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-layout]': 'layout()' },
  template: `
    <!--
      Navigation is 20+ tab stops wide with departments expanded. Every link
      keeps its own tab stop — this just gives a keyboard user one press to get
      past all of them, which arrow keys inside the nav cannot do.
    -->
    <a class="skip" href="#bo-content">Bỏ qua điều hướng</a>

    <!--
      On compact viewports the drawer is a modal surface, so it takes the focus
      trap and dialog semantics. On desktop it is ordinary page furniture and
      carries neither — the same component, two different contracts.
    -->
    <bo-navigation-sidebar
      [model]="nav.model()"
      [brand]="brand"
      [expansion]="nav.expansion()"
      (groupToggled)="nav.toggleById($event)"
      [rail]="layout() === 'rail'"
      [open]="drawerOpen()"
      [cdkTrapFocus]="modal()"
      [cdkTrapFocusAutoCapture]="modal()"
      [attr.role]="modal() ? 'dialog' : null"
      [attr.aria-modal]="modal() ? 'true' : null"
      [attr.aria-label]="modal() ? 'Điều hướng' : null"
      (keydown.escape)="closeDrawer()"
      (click)="onDrawerClick($event)"
    />

    @if (modal()) {
      <div class="scrim" (click)="closeDrawer()"></div>
    }

    <div class="main">
      <bo-topbar [showMenu]="layout() === 'drawer'" (menu)="openDrawer()" />
      <main class="content" id="bo-content" tabindex="-1"><router-outlet /></main>
    </div>
  `,
  styleUrl: './shell.scss',
})
export class Shell {
  private readonly router = inject(Router);
  protected readonly nav = inject(NavigationService);

  /**
   * The tenant's identity, restated in the navigation's vocabulary. One more
   * place where a business word stops before it reaches a reusable component.
   */
  protected readonly brand = (() => {
    const b = inject(BRANDING);
    return {
      name: b.productName,
      monogram: b.monogram,
      accent: b.accent,
      version: b.version,
      copyright: b.copyright,
    };
  })();
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly layout = inject(Viewport).layout;
  protected readonly drawerOpen = signal(false);

  /** Open *and* presented as a drawer — desktop never traps focus. */
  protected readonly modal = computed(() => this.layout() === 'drawer' && this.drawerOpen());

  /**
   * Whatever had focus when the drawer opened. CDK restores focus itself only
   * when the trap is destroyed, and this drawer is never destroyed — it is
   * moved off-canvas — so the restore is ours to perform.
   */
  private trigger: HTMLElement | null = null;

  constructor() {
    // Navigating away must close the drawer, or it covers the page it opened.
    this.router.events
      .pipe(
        filter((event) => event instanceof NavigationEnd),
        takeUntilDestroyed(),
      )
      .subscribe(() => this.closeDrawer());
  }

  /**
   * Choosing the destination you are already on produces no NavigationEnd, so
   * the drawer would sit there looking ignored. Any destination closes it; the
   * disclosure chevron is a button, not a link, and deliberately does not.
   */
  protected onDrawerClick(event: MouseEvent): void {
    if (this.modal() && (event.target as HTMLElement).closest('a')) this.closeDrawer();
  }

  protected openDrawer(): void {
    this.trigger = document.activeElement as HTMLElement | null;
    this.drawerOpen.set(true);
  }

  /** Every close path lands here, so focus always returns to one place. */
  protected closeDrawer(): void {
    if (!this.drawerOpen()) return;
    this.drawerOpen.set(false);

    // Browsers that do not focus a button on click leave `body` behind; the
    // menu button is the only control the topbar shows in this layout.
    const fallback = this.host.nativeElement.querySelector<HTMLElement>('bo-topbar button');
    const target = this.trigger?.isConnected && this.trigger !== document.body ? this.trigger : fallback;
    this.trigger = null;
    target?.focus();
  }
}
