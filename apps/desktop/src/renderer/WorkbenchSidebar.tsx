import {
  BriefcaseBusiness,
  Check,
  CircleUserRound,
  Images,
  Library,
  MessageCircle,
  MoreHorizontal,
  Music2,
  Plus,
  Settings,
  ShoppingBag,
  UserRound,
} from "lucide-react";
import type { KeyboardEvent, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { RunStatusGlyph } from "./RunStatusGlyph";
import type { TaskProjection } from "./taskThreadFixtures";
import type { TaskGrouping, TaskSort } from "./workbenchPreferences";

export type WorkbenchView = "work" | "browser" | "library" | "settings";

type WorkbenchSidebarProps = {
  activeView: WorkbenchView;
  grouping: TaskGrouping;
  selectedTaskId: string | null;
  settingsTriggerRef: RefObject<HTMLButtonElement | null>;
  sort: TaskSort;
  taskLoadStatus: "loading" | "ready" | "offline";
  tasks: TaskProjection[];
  onGroupingChange: (grouping: TaskGrouping) => void;
  onCreateTask: (skill?: TaskProjection) => void;
  onOpenSettings: () => void;
  onOpenTask: (task: TaskProjection) => void;
  onOpenView: (view: Exclude<WorkbenchView, "settings">) => void;
  onSortChange: (sort: TaskSort) => void;
};

const domainNavigation = [
  { id: "work", label: "任务", icon: BriefcaseBusiness },
  { id: "browser", label: "账号身份", icon: CircleUserRound },
  { id: "library", label: "站点技能", icon: Library },
] as const;

export function WorkbenchSidebar({
  activeView,
  grouping,
  selectedTaskId,
  settingsTriggerRef,
  sort,
  taskLoadStatus,
  tasks,
  onGroupingChange,
  onCreateTask,
  onOpenSettings,
  onOpenTask,
  onOpenView,
  onSortChange,
}: WorkbenchSidebarProps) {
  const groups = useMemo(() => groupTasks(tasks, grouping, sort), [grouping, sort, tasks]);

  return (
    <aside className="sidebar workbench-sidebar" aria-label="WebEnvoy navigation">
      <nav className="global-nav" aria-label="业务域导航">
        {domainNavigation.map(({ id, label, icon: Icon }) => (
          <button
            className={activeView === id ? "nav-item we-list-row nav-item-active" : "nav-item we-list-row"}
            type="button"
            aria-current={activeView === id ? "page" : undefined}
            onClick={() => onOpenView(id)}
            key={id}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <section className="task-tree codex-scrollbar" aria-label="任务线程列表">
        <TaskListHeading
          grouping={grouping}
          sort={sort}
          onCreateTask={onCreateTask}
          onGroupingChange={onGroupingChange}
          onSortChange={onSortChange}
        />

        {groups.map((group) => (
          <section className="task-thread-group" aria-label={group.label} key={group.id}>
            <div className="task-thread-group-label">
              {grouping === "skill" ? <SiteGlyph site={group.site} /> : <IdentityGlyph label={group.label} />}
              <span>
                <strong>{group.label}</strong>
                {grouping === "identity" && group.site ? <small>{group.site}</small> : null}
              </span>
              {grouping === "skill" ? (
                <button
                  className="task-group-add"
                  type="button"
                  aria-label={`使用其他账号身份创建${group.label}任务`}
                  title="使用其他账号身份创建任务"
                  onClick={() => onCreateTask(group.tasks[0])}
                >
                  <Plus size={14} />
                </button>
              ) : null}
            </div>
            {group.tasks.map((task) => (
              <button
                className={task.id === selectedTaskId ? "task-thread-row we-list-row selected" : "task-thread-row we-list-row"}
                type="button"
                aria-current={activeView === "work" && task.id === selectedTaskId ? "page" : undefined}
                title={grouping === "skill" ? task.accountIdentity : task.siteSkill}
                onClick={() => onOpenTask(task)}
                key={task.id}
              >
                {grouping === "skill" ? <IdentityGlyph label={task.accountIdentity} /> : <SiteGlyph site={task.threadContext!.siteLabel} />}
                <span>{grouping === "skill" ? task.accountIdentity : task.siteSkill}</span>
                {task.runs.at(-1) ? <RunStatusGlyph compact run={task.runs.at(-1)!} /> : null}
              </button>
            ))}
          </section>
        ))}

        {tasks.length === 0 ? (
          <p className="task-list-empty" role="status">
            {taskLoadStatus === "loading" ? "正在读取任务线程" : taskLoadStatus === "offline" ? "任务来源暂不可用" : "暂无任务线程"}
          </p>
        ) : null}
      </section>

      <footer className="sidebar-user-footer" aria-label="用户菜单">
        <button
          ref={settingsTriggerRef}
          className={activeView === "settings" ? "workbench-user-entry selected" : "workbench-user-entry"}
          type="button"
          aria-label="打开设置"
          aria-current={activeView === "settings" ? "page" : undefined}
          onClick={onOpenSettings}
        >
          <span className="user-avatar" aria-hidden="true"><UserRound size={15} /></span>
          <span className="user-copy"><strong>用户菜单</strong><span>设置</span></span>
          <Settings size={16} aria-hidden="true" />
        </button>
      </footer>
    </aside>
  );
}

function TaskListHeading({
  grouping,
  sort,
  onCreateTask,
  onGroupingChange,
  onSortChange,
}: {
  grouping: TaskGrouping;
  sort: TaskSort;
  onCreateTask: () => void;
  onGroupingChange: (grouping: TaskGrouping) => void;
  onSortChange: (sort: TaskSort) => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuHostRef = useRef<HTMLSpanElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuHostRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    menuHostRef.current?.querySelector<HTMLButtonElement>("[role='menuitemradio']")?.focus();
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function navigateMenu(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      menuHostRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
      ? items.length - 1
      : event.key === "ArrowDown"
      ? (currentIndex + 1) % items.length
      : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div className="section-heading task-list-heading">
      <span>任务线程</span>
      <span
        ref={menuHostRef}
        className="task-list-heading-actions"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false);
        }}
        onKeyDown={navigateMenu}
      >
        <button
          ref={menuButtonRef}
          type="button"
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          aria-label="整理任务线程"
          title="整理任务线程"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <MoreHorizontal size={15} />
        </button>
        <button type="button" aria-label="新建任务" title="新建任务" onClick={() => onCreateTask()}>
          <Plus size={15} />
        </button>
        {menuOpen ? (
          <div className="task-list-menu" role="menu" aria-label="任务线程整理方式">
            <span className="task-list-menu-label">分组方式</span>
            <PreferenceButton selected={grouping === "skill"} onSelect={() => { onGroupingChange("skill"); closeMenu(); }}>按站点技能</PreferenceButton>
            <PreferenceButton selected={grouping === "identity"} onSelect={() => { onGroupingChange("identity"); closeMenu(); }}>按账号身份</PreferenceButton>
            <span className="task-list-menu-separator" />
            <span className="task-list-menu-label">排序方式</span>
            <PreferenceButton selected={sort === "recent"} onSelect={() => { onSortChange("recent"); closeMenu(); }}>最近更新</PreferenceButton>
            <PreferenceButton selected={sort === "priority"} onSelect={() => { onSortChange("priority"); closeMenu(); }}>优先处理</PreferenceButton>
          </div>
        ) : null}
      </span>
    </div>
  );
}

function PreferenceButton({ selected, children, onSelect }: { selected: boolean; children: string; onSelect: () => void }) {
  return (
    <button
      className="task-list-menu-item"
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onClick={onSelect}
    >
      <span className="task-list-menu-check">{selected ? <Check size={13} /> : null}</span>
      {children}
    </button>
  );
}

function groupTasks(tasks: TaskProjection[], grouping: TaskGrouping, sort: TaskSort) {
  const sorted = tasks.map((task, index) => ({ task, index })).sort((left, right) => {
    if (sort === "recent") {
      return (right.task.updatedAt ?? "").localeCompare(left.task.updatedAt ?? "") || left.index - right.index;
    }
    return taskPriority(left.task) - taskPriority(right.task) || left.index - right.index;
  });
  const groups = new Map<string, TaskProjection[]>();
  for (const { task } of sorted) {
    const context = task.threadContext;
    if (context == null) continue;
    const key = grouping === "skill" ? context.siteSkillKey : context.accountIdentityKey;
    groups.set(key, [...(groups.get(key) ?? []), task]);
  }
  return [...groups].map(([key, groupedTasks]) => {
    const firstTask = groupedTasks[0];
    const site = firstTask.threadContext!.siteLabel;
    const label = grouping === "skill" ? firstTask.siteSkill : firstTask.accountIdentity;
    return { id: `${grouping}:${key}`, label, site, tasks: groupedTasks };
  });
}

function SiteGlyph({ site }: { site: string }) {
  if (site === "小红书") return <Images size={14} />;
  if (site === "微信公众号") return <MessageCircle size={14} />;
  if (site === "抖音") return <Music2 size={14} />;
  if (site === "淘宝") return <ShoppingBag size={14} />;
  return <BriefcaseBusiness size={14} />;
}

function IdentityGlyph({ label }: { label: string }) {
  return <span className="task-identity-glyph" aria-hidden="true">{label.trim().slice(0, 1) || <UserRound size={12} />}</span>;
}

function taskPriority(task: TaskProjection) {
  switch (task.runs.at(-1)?.lifecycle) {
    case "needs-action": return 0;
    case "running": return 1;
    case "queued": return 2;
    case "blocked": return 3;
    default: return 4;
  }
}
