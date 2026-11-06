// Shared empty-state panel (design-system primitive, F3). Purely
// presentational and server-safe: no hooks, no client directive.
//
// Renders the redesigned `.ff-empty` recipe from app/globals.css (dashed
// hairline, warm tint surface, centered column). Pass an optional `icon`
// (e.g. <Icon name="inbox" size={20} />) — it lands inside a 44px rounded
// accent-tinted tile. `compact` reduces the padding for use inside cards,
// drawers or split views.

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={compact ? "ff-empty ff-empty--compact" : "ff-empty"}>
      {icon ? (
        <div className="ff-empty-icon" aria-hidden="true">
          {icon}
        </div>
      ) : null}
      <h2>{title}</h2>
      {description ? <p className="ff-empty-description">{description}</p> : null}
      {action ? <div className="ff-empty-action">{action}</div> : null}
    </section>
  );
}
