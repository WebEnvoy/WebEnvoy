import { RefreshCw } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

type OwnerStateProps = Omit<ComponentPropsWithoutRef<"section">, "children" | "title"> & {
  title: string;
  summary: string;
  actionLabel?: string;
  onRecover?: () => void;
  recoverButtonFocusKey?: string;
};

export function OwnerState({
  title,
  summary,
  actionLabel = "检查连接",
  onRecover,
  recoverButtonFocusKey,
  ...sectionProps
}: OwnerStateProps) {
  return (
    <section {...sectionProps} className="owner-state" role="status">
      <RefreshCw size={20} aria-hidden="true" />
      <div><h1>{title}</h1><p>{summary}</p></div>
      {onRecover ? <button type="button" data-settings-return-focus={recoverButtonFocusKey} onClick={onRecover}>{actionLabel}</button> : null}
    </section>
  );
}
