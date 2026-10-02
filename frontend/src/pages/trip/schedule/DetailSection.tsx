import { useId, type ReactNode } from 'react';

/**
 * The detail panel's layout primitives: a titled section, and a label/value
 * row. A section of fields is a description list; a section of anything else
 * (the crew's list) is not, so the two are separate wrappers.
 */

export function Section({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="space-y-2 border-t border-gray-100 pt-4">
      <h3 id={id} className="text-xs font-semibold tracking-wide text-gray-500 uppercase">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function FieldSection({ title, children }: Readonly<{ title: string; children: ReactNode }>) {
  return (
    <Section title={title}>
      <dl className="space-y-2">{children}</dl>
    </Section>
  );
}

export function Field({ label, children }: Readonly<{ label: ReactNode; children: ReactNode }>) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2 text-sm">
      <dt className="text-gray-500">{label}</dt>
      <dd className="min-w-0 text-gray-900">{children}</dd>
    </div>
  );
}
