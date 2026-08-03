import {
  BriefcaseBusiness,
  Check,
  CircleUserRound,
  Ellipsis,
  Images,
  Languages,
  Library,
  MessageCircle,
  Music2,
  Network,
  Plus,
  ShieldCheck,
  ShoppingBag,
  SquarePen,
  Stethoscope,
} from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import {
  type AppView,
  type Identity,
  type PrototypeTask,
  type TaskState,
} from "./prototypeData";

export type TaskGrouping = "skill" | "identity";
export type TaskSort = "priority" | "recent";

type SettingsSection = "general" | "authorization" | "proxies" | "diagnostics";

type PrototypeSidebarProps = {
  identities: Identity[];
  settingsSection: SettingsSection;
  selectedTaskId: string;
  taskList: PrototypeTask[];
  taskGrouping: TaskGrouping;
  taskSort: TaskSort;
  view: AppView;
  onCreate: () => void;
  onCreateTaskForSkill: (site: string, skillName: string) => void;
  onOpenSettingsSection: (section: SettingsSection) => void;
  onOpenTask: (taskId: string) => void;
  onOpenView: (view: AppView) => void;
  onTaskGroupingChange: (grouping: TaskGrouping) => void;
  onTaskSortChange: (sort: TaskSort) => void;
};

export function PrototypeSidebar({
  identities,
  settingsSection,
  selectedTaskId,
  taskList,
  taskGrouping,
  taskSort,
  view,
  onCreate,
  onCreateTaskForSkill,
  onOpenSettingsSection,
  onOpenTask,
  onOpenView,
  onTaskGroupingChange,
  onTaskSortChange,
}: PrototypeSidebarProps) {
  return (
    <aside className="sidebar prototype-sidebar" aria-label="WebEnvoy navigation">
      <nav className="global-nav" aria-label="全局导航">
        <SidebarNav active={view === "work"} icon={<SquarePen size={16} />} label="任务" onClick={() => onOpenView("work")} />
        <SidebarNav active={view === "browser"} icon={<CircleUserRound size={16} />} label="账号身份" onClick={() => onOpenView("browser")} />
        <SidebarNav active={view === "library"} icon={<Library size={16} />} label="站点技能" onClick={() => onOpenView("library")} />
      </nav>

      <section className="prototype-sidebar-context codex-scrollbar">
        {view !== "settings" ? <>
          <SidebarHeading taskGrouping={taskGrouping} taskSort={taskSort} onCreate={onCreate} onTaskGroupingChange={onTaskGroupingChange} onTaskSortChange={onTaskSortChange} />
          <TaskTree grouping={taskGrouping} sort={taskSort} identities={identities} selectedTaskId={selectedTaskId} taskList={taskList} onCreateTaskForSkill={onCreateTaskForSkill} onOpenTask={onOpenTask} />
        </> : [
          { section: "general" as const, label: "通用", icon: <Languages size={14} /> },
          { section: "authorization" as const, label: "执行方式", icon: <ShieldCheck size={14} /> },
          { section: "proxies" as const, label: "代理", icon: <Network size={14} /> },
          { section: "diagnostics" as const, label: "诊断", icon: <Stethoscope size={14} /> },
        ].map((item) => (
          <button className={`prototype-sidebar-row site-row ${settingsSection === item.section ? "selected" : ""}`} type="button" aria-label={item.label} key={item.section} onClick={() => onOpenSettingsSection(item.section)}>
            {item.icon}<span><strong>{item.label}</strong></span>
          </button>
        ))}
      </section>

      <footer className="sidebar-user-footer prototype-user-footer">
        <button className="prototype-user-entry" type="button" aria-label="打开设置" onClick={() => onOpenSettingsSection("general")}>
          <span className="user-avatar" aria-hidden="true">CH</span>
          <span className="user-copy"><strong>Chen</strong></span>
        </button>
      </footer>
    </aside>
  );
}

function SidebarHeading({ taskGrouping, taskSort, onCreate, onTaskGroupingChange, onTaskSortChange }: Pick<PrototypeSidebarProps, "taskGrouping" | "taskSort" | "onCreate" | "onTaskGroupingChange" | "onTaskSortChange">) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuHostRef = useRef<HTMLSpanElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuHostRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutsideClick);
    return () => window.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [menuOpen]);

  useEffect(() => {
    if (menuOpen) menuHostRef.current?.querySelector<HTMLButtonElement>("[role='menuitemradio']")?.focus();
  }, [menuOpen]);

  function closeMenu() {
    setMenuOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  }

  function navigateMenu(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(menuHostRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : event.key === "ArrowDown" ? (currentIndex + 1) % items.length : (currentIndex - 1 + items.length) % items.length;
    items[nextIndex].focus();
  }

  return (
    <div className="section-heading task-list-heading">
      <span>任务线程</span>
      <span className="section-heading-actions task-list-heading-actions" ref={menuHostRef} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMenuOpen(false); }} onKeyDown={navigateMenu}>
        <button ref={menuButtonRef} type="button" aria-label="整理任务线程" title="整理" aria-expanded={menuOpen} onClick={() => setMenuOpen((open) => !open)}><Ellipsis size={15} /></button>
        <button type="button" aria-label="新建任务" title="新建任务" onClick={onCreate}><Plus size={15} /></button>
        {menuOpen ? <TaskListMenu grouping={taskGrouping} sort={taskSort} onGroupingChange={(grouping) => { onTaskGroupingChange(grouping); closeMenu(); }} onSortChange={(sort) => { onTaskSortChange(sort); closeMenu(); }} /> : null}
      </span>
    </div>
  );
}

function TaskListMenu({ grouping, sort, onGroupingChange, onSortChange }: { grouping: TaskGrouping; sort: TaskSort; onGroupingChange: (grouping: TaskGrouping) => void; onSortChange: (sort: TaskSort) => void }) {
  return (
    <div className="task-list-menu" role="menu" aria-label="任务线程整理方式">
      <span className="task-list-menu-label">分组方式</span>
      <MenuChoice checked={grouping === "skill"} label="按站点技能" onClick={() => onGroupingChange("skill")} />
      <MenuChoice checked={grouping === "identity"} label="按账号身份" onClick={() => onGroupingChange("identity")} />
      <span className="task-list-menu-separator" />
      <span className="task-list-menu-label">排序方式</span>
      <MenuChoice checked={sort === "priority"} label="优先级" onClick={() => onSortChange("priority")} />
      <MenuChoice checked={sort === "recent"} label="最近更新" onClick={() => onSortChange("recent")} />
    </div>
  );
}

function MenuChoice({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return <button className="task-list-menu-item" type="button" role="menuitemradio" aria-label={label} aria-checked={checked} onClick={onClick}><span className="task-list-menu-check">{checked ? <Check size={13} /> : null}</span>{label}</button>;
}

function TaskTree({ grouping, sort, identities, selectedTaskId, taskList, onCreateTaskForSkill, onOpenTask }: { grouping: TaskGrouping; sort: TaskSort; identities: Identity[]; selectedTaskId: string; taskList: PrototypeTask[]; onCreateTaskForSkill: (site: string, skillName: string) => void; onOpenTask: (taskId: string) => void }) {
  const orderedTasks = sortTasks(taskList, sort);
  if (grouping === "identity") {
    const identityIds = Array.from(new Set(orderedTasks.map((task) => task.identityId)));
    return identityIds.map((identityId) => {
      const identityTasks = orderedTasks.filter((task) => task.identityId === identityId);
      const identity = identities.find((item) => item.id === identityId);
      const account = identity?.account ?? identityTasks[0].identity;
      const site = identity?.site ?? identityTasks[0].site;
      return (
        <div className="prototype-task-tree-site" key={identityId}>
          <div className="prototype-task-tree-label task-identity-group"><span className="prototype-account-mark">{identity?.accountAvatar ?? account.slice(0, 1)}</span><span><strong>{account}</strong><small>{site}</small></span></div>
          {identityTasks.map((task) => <TaskThreadRow key={task.id} primary={task.skill} selected={selectedTaskId === task.id} task={task} onOpenTask={onOpenTask} />)}
        </div>
      );
    });
  }

  const skillKeys = Array.from(new Set(orderedTasks.map((task) => `${task.site}\u0000${task.skill}`)));
  return skillKeys.map((skillKey) => {
    const [site, skill] = skillKey.split("\u0000");
    const skillTasks = orderedTasks.filter((task) => task.site === site && task.skill === skill);
    return (
      <div className="prototype-task-tree-site task-skill-group" key={skillKey}>
        <div className="prototype-task-tree-label skill-group-heading"><SiteGlyph site={site} /><strong>{skill}</strong><button className="skill-group-add" type="button" aria-label={`使用其他账号身份创建${skill}任务`} title="使用其他账号身份创建任务" onClick={() => onCreateTaskForSkill(site, skill)}><Plus size={14} /></button></div>
        {skillTasks.map((task) => {
          const identity = identities.find((item) => item.id === task.identityId);
          const primary = identity?.account ?? task.identity;
          return <TaskThreadRow avatar={identity?.accountAvatar ?? primary.slice(0, 1)} key={task.id} primary={primary} selected={selectedTaskId === task.id} task={task} onOpenTask={onOpenTask} />;
        })}
      </div>
    );
  });
}

function sortTasks(taskList: PrototypeTask[], sort: TaskSort) {
  const tasksWithOrder = taskList.map((task, index) => ({ task, index }));
  tasksWithOrder.sort((left, right) => {
    if (sort === "priority") {
      const priorityDifference = taskPriority(left.task.state) - taskPriority(right.task.state);
      if (priorityDifference !== 0) return priorityDifference;
    } else {
      const recencyDifference = taskRecency(right.task.updatedAt) - taskRecency(left.task.updatedAt);
      if (recencyDifference !== 0) return recencyDifference;
    }
    return left.index - right.index;
  });
  return tasksWithOrder.map(({ task }) => task);
}

function taskPriority(state: TaskState) {
  const priority: Record<TaskState, number> = { waiting: 0, unknown: 1, checking: 2, failed: 3, partial: 4, "not-submitted": 5, cancelled: 6, running: 7, success: 8 };
  return priority[state];
}

function taskRecency(label: string) {
  if (label === "刚刚") return 20_000;
  const minutesAgo = label.match(/^(\d+) 分钟前$/);
  if (minutesAgo != null) return 19_000 - Number(minutesAgo[1]);
  const today = label.match(/^今天 (\d{2}):(\d{2})$/);
  if (today != null) return 10_000 + Number(today[1]) * 60 + Number(today[2]);
  return 0;
}

function TaskThreadRow({ avatar, primary, selected, task, onOpenTask }: { avatar?: string; primary: string; selected: boolean; task: PrototypeTask; onOpenTask: (taskId: string) => void }) {
  const turnCount = task.runs?.length ?? 1;
  const latestInput = task.runs?.at(-1)?.input ?? task.title;
  return <button className={`prototype-sidebar-row task-tree-leaf ${selected ? "selected" : ""}`} type="button" aria-label={`${primary}，${turnCount} 个回合，${task.stateLabel}`} title={latestInput} onClick={() => onOpenTask(task.id)}>{avatar == null ? <span className={`prototype-status-dot ${task.state}`} aria-hidden="true" /> : <span className="prototype-account-mark prototype-thread-avatar" aria-hidden="true">{avatar}</span>}<span><strong>{primary}</strong></span></button>;
}

function SiteGlyph({ site }: { site: string }) {
  if (site === "小红书") return <Images size={14} />;
  if (site === "微信公众号") return <MessageCircle size={14} />;
  if (site === "抖音") return <Music2 size={14} />;
  if (site === "淘宝") return <ShoppingBag size={14} />;
  return <BriefcaseBusiness size={14} />;
}

function SidebarNav({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return <button className={`nav-item ${active ? "nav-item-active" : ""}`} type="button" onClick={onClick}>{icon}{label}</button>;
}
