import { useId, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

/**
 * The detail panel's layout primitives: a titled section, and a label/value
 * row. A section of fields is a description list; a section of anything else
 * (the route, the crew) is not, so the two are separate wrappers.
 *
 * ★ ONE ICON PER SECTION, BESIDE ITS TITLE — never one per row. It is there to
 * be found at a glance down a long panel, not to decorate every fact.
 */

export function Section({ title, icon: Icon, children }: Readonly<{ title: string; icon: LucideIcon; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-3 border-t border-gray-100 pt-4">
      <h3 id={id} className="flex items-center gap-2 text-xs font-semibold tracking-wide text-gray-500 uppercase">
        <Icon className="size-4 text-gray-400" aria-hidden="true" />
        {title}
      </h3>
      {children}
    </section>
  );
}

export function FieldSection({ title, icon, children }: Readonly<{ title: string; icon: LucideIcon; children: ReactNode }>) {
  return (
    <Section title={title} icon={icon}>
      <dl className="space-y-2.5">{children}</dl>
    </Section>
  );
}

/**
 * A label and its value. Side by side for short facts (a price, a date);
 * `stacked` — the label above — for prose that needs the panel's whole width
 * (a customer's name, a cargo note), which a fixed label column would squeeze.
 */
export function Field({ label, stacked = false, children }: Readonly<{ label: ReactNode; stacked?: boolean; children: ReactNode }>) {
  if (stacked) {
    return (
      <div className="space-y-0.5 text-sm">
        <dt className="text-xs text-gray-500">{label}</dt>
        <dd className="min-w-0 text-gray-900">{children}</dd>
      </div>
    );
  }
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 text-gray-900">{children}</dd>
    </div>
  );
}
