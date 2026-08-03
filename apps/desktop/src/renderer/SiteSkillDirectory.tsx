import { CircleAlert, CircleCheck, Download, Globe2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { isCandidateUsable, loadingSkillIdentityCompatibility, type SkillIdentityCompatibilityState } from "./coreIdentityCompatibilityClient";
import type { IdentityEnvironmentProjection } from "./identityEnvironmentFixtures";
import {
  catalogSkillName,
  catalogSkillSiteName,
  type LodeCatalogLoadState,
  type LodeCatalogSkill,
} from "./lodeCatalogClient";
import type { RuntimeSupervisorState } from "./runtimeSupervisorState";
import {
  candidateIdentityList,
  compatibilityCandidate,
  skillLaunchState,
} from "./skillCompatibilityPresentation";
import { actionLabel, categoryLabel, displaySummary, skillStatusLabel } from "./siteSkillPresentation";

export type SiteSkillDirectoryProps = {
  catalog: LodeCatalogLoadState;
  compatibilityBySkill: Record<string, SkillIdentityCompatibilityState>;
  identities: IdentityEnvironmentProjection[];
  runtimeSupervisorState: RuntimeSupervisorState;
  initialFocusSkillId?: string;
  onOpen: (skill: LodeCatalogSkill) => void;
  onUse: (skill: LodeCatalogSkill, identityId?: string) => void;
};

export function SiteSkillDirectory(props: SiteSkillDirectoryProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const restoredSkillRef = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("全部");
  const [installNoticeOpen, setInstallNoticeOpen] = useState(false);
  const visibleSkills = useMemo(
    () => props.catalog.skills.filter((skill) => !skill.facets.includes("sample")),
    [props.catalog.skills],
  );
  const categories = useMemo(
    () => ["全部", ...Array.from(new Set(visibleSkills.map((skill) => categoryLabel(skill.category))))],
    [visibleSkills],
  );
  const filteredSkills = useMemo(
    () => filterSkills(visibleSkills, category, query),
    [visibleSkills, category, query],
  );
  useEffect(() => {
    (props.initialFocusSkillId ? restoredSkillRef.current : searchRef.current)?.focus();
  }, [props.initialFocusSkillId]);

  return (
    <div className="production-library-page">
      <DirectoryHeading
        catalog={props.catalog}
        installNoticeOpen={installNoticeOpen}
        onToggleInstallNotice={() => setInstallNoticeOpen((open) => !open)}
      />
      <DirectoryToolbar
        categories={categories}
        category={category}
        query={query}
        searchRef={searchRef}
        onCategory={setCategory}
        onQuery={setQuery}
      />
      <DirectoryResults
        {...props}
        restoredSkillRef={restoredSkillRef}
        skills={filteredSkills}
        onClear={() => { setQuery(""); setCategory("全部"); }}
      />
    </div>
  );
}

function DirectoryHeading({
  catalog,
  installNoticeOpen,
  onToggleInstallNotice,
}: Pick<SiteSkillDirectoryProps, "catalog"> & { installNoticeOpen: boolean; onToggleInstallNotice: () => void }) {
  return (
    <>
      <header className="production-page-heading">
        <div><h1>发现站点技能</h1><p>按站点和业务类型查找已安装技能。</p></div>
        <button className="production-icon-button" type="button" aria-label="添加站点技能" title="添加站点技能" onClick={onToggleInstallNotice}>
          <Plus size={16} />
        </button>
      </header>
      {catalog.status === "stale" ? (
        <div className="library-source-notice warning" role="status"><CircleAlert size={15} /><span>{catalog.summary}</span></div>
      ) : null}
      {installNoticeOpen ? (
        <div className="library-source-notice" role="status">
          <Download size={15} /><span>当前只展示本机已安装技能；新增与更新将在 Lode 安装接口可用后开放。</span>
        </div>
      ) : null}
    </>
  );
}

function DirectoryToolbar({
  categories,
  category,
  query,
  searchRef,
  onCategory,
  onQuery,
}: {
  categories: string[];
  category: string;
  query: string;
  searchRef: React.RefObject<HTMLInputElement | null>;
  onCategory: (category: string) => void;
  onQuery: (query: string) => void;
}) {
  return (
    <div className="production-library-toolbar">
      <label className="production-library-search">
        <Search size={15} />
        <input ref={searchRef} aria-label="搜索站点或技能" value={query} placeholder="搜索站点或技能" onChange={(event) => onQuery(event.currentTarget.value)} />
      </label>
      <div className="production-library-filters" role="group" aria-label="业务类型筛选">
        {categories.map((item) => (
          <button className={category === item ? "selected" : ""} type="button" aria-pressed={category === item} onClick={() => onCategory(item)} key={item}>
            {item}
          </button>
        ))}
      </div>
    </div>
  );
}

function DirectoryResults({ skills, onClear, restoredSkillRef, ...props }: SiteSkillDirectoryProps & {
  skills: LodeCatalogSkill[];
  onClear: () => void;
  restoredSkillRef: React.RefObject<HTMLButtonElement | null>;
}) {
  const sites = Array.from(new Set(skills.map(catalogSkillSiteName)));
  if (sites.length === 0) {
    return (
      <div className="production-library-empty" role="status">
        <Search size={22} /><h2>没有匹配的站点技能</h2><button type="button" onClick={onClear}>清除筛选</button>
      </div>
    );
  }
  return (
    <div className="production-skill-sites">
      {sites.map((site) => (
        <section className="production-skill-site" aria-labelledby={`site-${site}`} key={site}>
          <div className="production-skill-site-heading">
            <span className="production-site-glyph"><Globe2 size={15} /></span><h2 id={`site-${site}`}>{site}</h2>
          </div>
          <div className="production-skill-list">
            {skills.filter((skill) => catalogSkillSiteName(skill) === site).map((skill) => (
              <SiteSkillRow
                {...props}
                mainButtonRef={skill.id === props.initialFocusSkillId ? restoredSkillRef : undefined}
                skill={skill}
                onOpen={() => props.onOpen(skill)}
                key={skill.id}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SiteSkillRow({
  catalog,
  compatibilityBySkill,
  identities,
  runtimeSupervisorState,
  skill,
  mainButtonRef,
  onOpen,
  onUse,
}: Omit<SiteSkillDirectoryProps, "onOpen"> & {
  mainButtonRef?: React.RefObject<HTMLButtonElement | null>;
  skill: LodeCatalogSkill;
  onOpen: () => void;
}) {
  const compatibility = compatibilityBySkill[skill.id] ?? loadingSkillIdentityCompatibility();
  const candidates = candidateIdentityList(skill, identities);
  const defaultIdentity = candidates.find((identity) => isCandidateUsable(compatibilityCandidate(identity, compatibility))) ?? candidates[0];
  const candidate = compatibilityCandidate(defaultIdentity, compatibility);
  const launch = skillLaunchState(skill, defaultIdentity, candidate, compatibility, runtimeSupervisorState, catalog.status);
  return (
    <div className="production-skill-row">
      <button ref={mainButtonRef} className="production-skill-row-main" type="button" onClick={onOpen}>
        <span className="production-skill-icon"><Globe2 size={17} /></span>
        <span>
          <strong>{catalogSkillName(skill)}</strong><small>{displaySummary(skill)}</small>
          <span className="production-skill-tags">
            <em>{categoryLabel(skill.category)}</em>{skill.actions.map((action) => <em key={action.id}>{actionLabel(action.category)}</em>)}
          </span>
        </span>
      </button>
      <div className="production-skill-row-actions">
        <span className={skill.availability === "available" ? "skill-status available" : "skill-status warning"}>
          {skill.availability === "available" ? <CircleCheck size={13} /> : <CircleAlert size={13} />}{skillStatusLabel(skill)}
        </span>
        <button className="production-primary-button compact" type="button" disabled={!launch.ok} title={launch.reason} onClick={() => onUse(skill, defaultIdentity?.id)}>
          去使用
        </button>
      </div>
    </div>
  );
}

function filterSkills(skills: LodeCatalogSkill[], category: string, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  return skills.filter((skill) =>
    (category === "全部" || categoryLabel(skill.category) === category) &&
    (normalizedQuery.length === 0 ||
      `${catalogSkillSiteName(skill)} ${catalogSkillName(skill)} ${skill.summary} ${skill.category}`
        .toLowerCase()
        .includes(normalizedQuery)),
  );
}
