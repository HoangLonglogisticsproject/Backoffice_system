import { Popover as PopoverPrimitive } from '@base-ui/react/popover';

import { cn } from '@/utils';

/**
 * A panel anchored to the thing that opened it.
 *
 * ★ THE PRIMITIVE OWNS THE BEHAVIOUR; THIS FILE OWNS THE LOOK. Focus trapping,
 * Escape, click-outside, `aria-expanded` on the trigger and the return of focus
 * when it closes all come from Base UI — the same arrangement `select.tsx` and
 * `modal.tsx` already use. A hand-rolled dropdown is where keyboard access goes
 * to die, and this product is used with a keyboard at a desk.
 *
 * ★ NOT A MODAL, AND THE DIFFERENCE IS THE POINT. A modal takes the page away
 * until it is answered; a popover is a glance that the page keeps running
 * behind. The bell is a glance.
 */

const Popover = PopoverPrimitive.Root;
const PopoverTrigger = PopoverPrimitive.Trigger;

function PopoverContent({
  className,
  children,
  side = 'bottom',
  sideOffset = 8,
  align = 'end',
  ...props
}: PopoverPrimitive.Popup.Props &
  Pick<PopoverPrimitive.Positioner.Props, 'align' | 'side' | 'sideOffset'>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        className="isolate z-50"
      >
        <PopoverPrimitive.Popup
          data-slot="popover-content"
          className={cn(
            // `max-h-(--available-height)` is the primitive's own measurement of
            // the room left on screen: a long list scrolls inside the panel
            // instead of running off the bottom of a laptop.
            'max-h-(--available-height) origin-(--transform-origin) overflow-y-auto rounded-xl bg-popover text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-none',
            'duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
        </PopoverPrimitive.Popup>
      </PopoverPrimitive.Positioner>
    </PopoverPrimitive.Portal>
  );
}

export { Popover, PopoverTrigger, PopoverContent };
