import { Check } from 'lucide-react';
import { cn } from '@/utils/cn';

/**
 * A horizontal progress indicator: where in a fixed sequence something stands.
 *
 * ★ GENERIC ON PURPOSE. It knows three states and a label per step, and
 * nothing about trips, approvals or drivers — the caller derives the states.
 * One current step, marked for assistive technology with `aria-current`.
 */
export type StepperState = 'done' | 'current' | 'upcoming';

export interface StepperStep {
  key: string;
  label: string;
  state: StepperState;
}

export function Stepper({ steps, label }: Readonly<{ steps: StepperStep[]; label: string }>) {
  return (
    <ol aria-label={label} className="flex items-start">
      {steps.map((step, index) => (
        <li
          key={step.key}
          aria-current={step.state === 'current' ? 'step' : undefined}
          className="relative flex flex-1 flex-col items-center gap-1.5 text-center"
        >
          {index > 0 ? (
            <span
              aria-hidden
              className={cn(
                'absolute top-3.5 right-1/2 left-[-50%] h-0.5',
                step.state === 'upcoming' ? 'bg-border' : 'bg-primary',
              )}
            />
          ) : null}
          <span
            aria-hidden
            className={cn(
              'relative z-10 flex size-7 items-center justify-center rounded-full border-2 bg-background text-xs font-semibold',
              step.state === 'done' && 'border-primary bg-primary text-primary-foreground',
              step.state === 'current' && 'border-primary text-primary ring-4 ring-primary/15',
              step.state === 'upcoming' && 'border-border text-muted-foreground',
            )}
          >
            {step.state === 'done' ? <Check className="size-4" /> : index + 1}
          </span>
          <span
            className={cn(
              'text-xs leading-tight',
              step.state === 'current' ? 'font-semibold text-foreground' : 'text-muted-foreground',
            )}
          >
            {step.label}
          </span>
        </li>
      ))}
    </ol>
  );
}
