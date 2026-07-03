// ---------------------------------------------------------------------------
// PageHeader — one consistent page title block for the whole OS: an optional
// eyebrow, the title in the brand's uppercase Barlow Condensed display face,
// an optional subtitle, and optional right-aligned actions. Replaces the
// hand-rolled, inconsistently-cased headings across pages.
// ---------------------------------------------------------------------------
import type { ReactNode } from "react";

export default function PageHeader({
  eyebrow,
  title,
  subtitle,
  actions,
}: {
  eyebrow?: ReactNode;
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs uppercase tracking-widest text-gray-600">{eyebrow}</p>
        )}
        <h1 className="font-display text-3xl font-bold uppercase tracking-wide text-gray-100">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1 max-w-2xl text-sm text-gray-500">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
