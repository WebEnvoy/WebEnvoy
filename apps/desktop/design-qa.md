# Design QA

## Target

- Existing WebEnvoy Codex-like shell references:
  - `artifacts/app-265-packaged-readonly-smoke.png`
  - `artifacts/app-234-identity-page-browser.png`
  - `artifacts/gh-171-app-level-site-skill.png`
- Approved product inputs:
  - `docs/stories/APP-308.md`
  - `docs/design/human-workbench-information-architecture.md`

The target is the existing shell and interaction grammar, not a pixel clone of
the status-heavy production pages.

## Approved Baseline

- Story and IA: confirmed by the user on 2026-07-19.
- Visual and interaction baseline: prototype head
  `ddcd13d6cb556cfbe65a72f466d9f12992d438fc`.
- The runnable prototype is the review artifact. Transient screenshots and
  sample state are not production or live-runtime evidence.

## Verified Design Decisions

- Work, Browser and Library are the business domains; Settings is a utility.
- A Task Thread is fixed by Site Skill and Account Identity. Each structured
  business submission appends one Task Turn.
- Work can group the same threads by skill or identity without duplicating task
  facts; the center retains the complete chronological timeline.
- Execution configuration uses Read and Download, Fill Without Submit, Publish
  or Submit, and Dangerous Actions. Each category is Auto, Confirm or Block.
- Effective configuration is current action decision, current Task Thread,
  My Skill Default, then global default. Runtime confirmation offers only allow
  once or reject; longer-lived changes happen from Composer, Library or Settings.
- App-owned standard result components remain the fallback. An optional skill
  result view receives only current structured output and returns actions through
  the App policy path.
- Account Identity copy is an App intent to the local Provider. The App does not
  read or store raw cookies, credentials, profile storage or runtime truth.
- The prototype imports no Core, Harbor or Lode client and performs no owner API,
  IPC or live-site request.

## Verification

```bash
npm run typecheck
npx vite build --config vite.prototype.config.ts
npm run build
git diff --check
```

All commands passed at the reviewed baseline. Production runtime was not
contacted.

final result: passed

This QA result does not constitute the required user approval for App #305.
