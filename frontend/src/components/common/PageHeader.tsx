import type { ReactNode } from 'react';

/**
 * The card every Backoffice screen opens with: a title, an optional line
 * under it, and the screen's primary action on the right. Extracted from the
 * approvals screen so the next screen gets the same card rather than a copy
 * of its classes.
 */
export function PageHeader({
  title,
  subtitle,
  actions,
}: Readonly<{ title: string; subtitle?: ReactNode; actions?: ReactNode }>) {
  return (
    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-xl border border-gray-100 shadow-sm">
      <div>
        <h1 className="text-xl font-bold text-gray-900">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-gray-500">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}
