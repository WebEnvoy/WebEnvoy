import { FileText, Link, Paperclip } from "lucide-react";

import type { CoreThreadInputField, CoreThreadInputSnapshot } from "./coreThreadInputContract";
import type { LodeCatalogSkill } from "./lodeCatalogClient";

export function TaskTurnBusinessInput({ input, skill }: {
  input: CoreThreadInputSnapshot;
  skill?: LodeCatalogSkill;
}) {
  if (input.fields.length === 0 && input.attachment_refs.length === 0) return null;
  return (
    <section className="task-turn-business-input" aria-label="本回合业务输入">
      <div className="task-turn-business-input-heading">
        <FileText size={15} />
        <strong>{skill?.name ?? "业务输入"}</strong>
        {skill == null ? <small title="历史回合未绑定精确字段定义版本">历史字段</small> : null}
      </div>
      <dl>
        {input.fields.map((field) => {
          return (
            <div key={field.field_id}>
              <dt>{skill?.inputFields.find((item) => item.id === field.field_id)?.label ?? field.field_id}</dt>
              <dd>{inputValue(field)}</dd>
            </div>
          );
        })}
        {input.attachment_refs.length > 0 ? (
          <div>
            <dt>附件</dt>
            <dd><Paperclip size={13} />{input.attachment_refs.length} 个文件</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

function inputValue(field: CoreThreadInputField) {
  if (field.kind === "url") return <span className="task-turn-input-url"><Link size={13} />{field.summary}</span>;
  if (field.summary != null) return field.summary;
  if (field.kind === "file" || field.kind === "attachment") return "已添加文件";
  return "已提交受保护输入";
}
