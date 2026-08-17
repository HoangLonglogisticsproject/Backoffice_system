import { NgComponentOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, input, resource } from '@angular/core';
import { WorkspaceWidget } from '@bo/services';
import { Skeleton } from '@bo/components';

/** Resolves one widget's lazy component, showing a placeholder meanwhile. */
@Component({
  selector: 'bo-lazy-widget',
  imports: [NgComponentOutlet, Skeleton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (component.value(); as loaded) {
      <ng-container *ngComponentOutlet="loaded" />
    } @else {
      <bo-skeleton height="180px" />
    }
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class LazyWidget {
  readonly widget = input.required<WorkspaceWidget>();

  protected readonly component = resource({
    params: () => this.widget(),
    loader: ({ params }) => params.load(),
  });
}
