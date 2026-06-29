# 0001. Record Architecture Decisions

## Status

Accepted.

## Context

WebEnvoy Core already has draft architecture notes under `docs/draft/`, but the drafts are not final contracts. Harbor, Lode, App, CLI, MCP and SDK work need a small way to point at stable direction without copying long planning text into each downstream design.

The repository has no ADR convention yet.

## Decision

Record durable architecture decisions in `docs/adr/` as numbered Markdown files.

Each ADR uses this minimal format:

- `Status`
- `Context`
- `Decision`
- `Consequences`
- `Alternatives Considered`
- `Research Evidence`
- `Open Questions`

ADR statuses are `Proposed`, `Accepted`, `Superseded`, `Rejected` or `Deprecated`. A proposed ADR can guide design, but downstream schemas and implementation still need their own tests and migration notes.

Every Core contract ADR must say what WebEnvoy Core owns and what it only references from Harbor, Lode or WebEnvoy App. Research should be linked by file and theme, not copied into the ADR.

## Consequences

Downstream design can cite a small decision record instead of treating draft docs as implicit contracts.

Some duplication with `docs/draft/` remains intentional. Draft docs can explore; ADRs freeze the current choice and its tradeoffs.

## Alternatives Considered

- Keep only `docs/draft/`: rejected because drafts mix exploration, candidate fields and future work.
- Write full specifications first: rejected because the current goal is to freeze public contract direction, not final JSON Schema or API syntax.
- Use a heavier ADR template: rejected because this repository needs a small decision log, not process overhead.

## Research Evidence

This ADR is a repository process decision. It is grounded in the draft boundary stated in [docs/draft/README.md](../draft/README.md) and the repository requirement that shared schemas and App-facing APIs stay consistent in [AGENTS.md](../../AGENTS.md).

## Open Questions

- Whether future public contract schemas should remain in this AGPL repository or move to a separate permissive `contracts` or SDK repository.
- Whether accepted ADRs should later be indexed from a dedicated `docs/adr/README.md` once the list grows.
