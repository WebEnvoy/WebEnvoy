import { FileUp, X } from "lucide-react";
import { useRef } from "react";

import { browserAttachments, selectLocalAttachments } from "./localFileClient";
import type { LodeCatalogSkill } from "./lodeCatalogClient";
import type { SkillInputAttachment, SkillInputDraft, SkillInputValue } from "./skillInputDraft";

type CreateTaskFieldsProps = {
  draft: SkillInputDraft;
  errors: Record<string, string>;
  skill: LodeCatalogSkill;
  submitted: boolean;
  touched: Set<string>;
  onBlur: (fieldId: string) => void;
  onFiles: (fieldId: string, files: SkillInputAttachment[]) => void;
  onValue: (fieldId: string, value: SkillInputValue) => void;
};

export function CreateTaskFields(props: CreateTaskFieldsProps) {
  return (
    <div className="create-task-fields">
      {props.skill.inputFields.filter((field) => field.kind !== "constant").map((field) => (
        <SkillFieldControl
          draft={props.draft}
          error={props.submitted || props.touched.has(field.id) ? props.errors[field.id] : undefined}
          field={field}
          onBlur={() => props.onBlur(field.id)}
          onFiles={(files) => props.onFiles(field.id, files)}
          onRemoveFile={(attachmentId) => props.onFiles(field.id, (props.draft.files[field.id] ?? []).filter((item) => item.id !== attachmentId))}
          onValue={(value) => props.onValue(field.id, value)}
          key={field.id}
        />
      ))}
    </div>
  );
}

function SkillFieldControl({ draft, error, field, onBlur, onFiles, onRemoveFile, onValue }: {
  draft: SkillInputDraft;
  error?: string;
  field: WebEnvoyLodeCatalogField;
  onBlur: () => void;
  onFiles: (files: SkillInputAttachment[]) => void;
  onRemoveFile: (attachmentId: string) => void;
  onValue: (value: SkillInputValue) => void;
}) {
  const value = draft.values[field.id];
  const controlId = `create-field-${field.id}`;
  const labelId = `${controlId}-label`;
  const descriptionId = `${controlId}-description`;
  const errorId = `create-field-${field.id}-error`;
  const common = { id: controlId, name: field.id, onBlur, "aria-invalid": error != null, "aria-describedby": descriptionId, "aria-errormessage": error == null ? undefined : errorId };
  const grouped = field.kind === "multi-select" || field.kind === "file";
  let control;
  if (field.kind === "boolean") {
    control = <input {...common} type="checkbox" checked={value === true} onChange={(event) => onValue(event.currentTarget.checked)} />;
  } else if (field.kind === "select") {
    control = <select {...common} value={typeof value === "string" ? value : ""} onChange={(event) => onValue(event.currentTarget.value)}><option value="">请选择</option>{field.options?.map((option) => <option value={option} key={option}>{option}</option>)}</select>;
  } else if (field.kind === "multi-select") {
    const selected = Array.isArray(value) ? value : [];
    control = <div className="create-task-multi-select" role="group" tabIndex={-1} aria-labelledby={labelId} aria-describedby={descriptionId} aria-invalid={error != null} aria-errormessage={error == null ? undefined : errorId}>{field.options?.map((option) => <label key={option}><input type="checkbox" checked={selected.includes(option)} onBlur={onBlur} onChange={(event) => onValue(event.currentTarget.checked ? [...selected, option] : selected.filter((item) => item !== option))} />{option}</label>)}</div>;
  } else if (field.kind === "file") {
    control = <FileFieldControl attachments={draft.files[field.id] ?? []} controlId={controlId} descriptionId={descriptionId} errorId={errorId} error={error} fieldId={field.id} onBlur={onBlur} onFiles={onFiles} onRemove={onRemoveFile} />;
  } else if (field.kind === "multiline") {
    control = <textarea {...common} value={typeof value === "string" ? value : ""} maxLength={field.maxLength} onChange={(event) => onValue(event.currentTarget.value)} />;
  } else {
    control = <input {...common} type={field.kind === "number" ? "number" : field.format === "uri" ? "url" : "text"} value={typeof value === "string" ? value : ""} min={field.minimum} max={field.maximum} step={field.integer ? 1 : undefined} minLength={field.minLength} maxLength={field.maxLength} onChange={(event) => onValue(event.currentTarget.value)} />;
  }
  return (
    <div className={`create-task-field ${field.kind === "multiline" ? "wide" : ""}`}>
      {grouped
        ? <span className="create-task-field-label" id={labelId}><strong>{field.label}</strong>{field.required ? <em>必填</em> : null}</span>
        : <label id={labelId} htmlFor={controlId}><strong>{field.label}</strong>{field.required ? <em>必填</em> : null}</label>}
      {control}
      <small id={descriptionId}>{error ?? field.description}</small>
      {error != null ? <span className="sr-only" id={errorId}>{error}</span> : null}
    </div>
  );
}

function FileFieldControl({ attachments, controlId, descriptionId, error, errorId, fieldId, onBlur, onFiles, onRemove }: {
  attachments: SkillInputAttachment[];
  controlId: string;
  descriptionId: string;
  error?: string;
  errorId: string;
  fieldId: string;
  onBlur: () => void;
  onFiles: (files: SkillInputAttachment[]) => void;
  onRemove: (attachmentId: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  async function selectFiles() {
    const files = await selectLocalAttachments();
    if (files == null) inputRef.current?.click();
    else if (files.length > 0) onFiles(files);
  }
  return (
    <div className="create-task-file-field" role="group" tabIndex={-1} aria-labelledby={`${controlId}-label`} aria-describedby={descriptionId} aria-invalid={error != null} aria-errormessage={error == null ? undefined : errorId}>
      {attachments.length > 0 ? (
        <div className="create-task-file-list">
          {attachments.map((attachment) => (
            <span className={attachment.state === "ready" ? "" : "invalid"} key={attachment.id}>
              <span className="create-task-file-name">{attachment.name}{attachment.state === "ready" ? "" : "（需重新选择）"}</span>
              <button type="button" aria-label={`移除附件 ${attachment.name}`} title="移除附件" onClick={() => onRemove(attachment.id)}><X size={12} /></button>
            </span>
          ))}
          <button type="button" onClick={() => onFiles([])}>清空附件</button>
        </div>
      ) : null}
      <button className="create-task-file-control" type="button" onClick={selectFiles}><FileUp size={15} /><span>选择附件</span></button>
      <input id={controlId} name={fieldId} ref={inputRef} className="sr-only" type="file" multiple onBlur={onBlur} onChange={(event) => onFiles(browserAttachments(Array.from(event.currentTarget.files ?? [])))} />
    </div>
  );
}
