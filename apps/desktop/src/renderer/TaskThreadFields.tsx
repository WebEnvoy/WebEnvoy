import type { ReactNode } from "react";

import type { RunProjection } from "./taskThreadFixtures";

export function outcomeLabel(outcome: RunProjection["outcome"]) {
  return `outcome: ${outcome}`;
}

export function SourceField({
  label,
  value,
  source,
}: {
  label: string;
  value: string;
  source: string;
}) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
      <span className="source-chip">{source}</span>
    </div>
  );
}

export function ContextPanel({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="context-copy">
      <div className="card-title">
        {icon}
        <h3>{title}</h3>
      </div>
      <p>{body}</p>
    </div>
  );
}
