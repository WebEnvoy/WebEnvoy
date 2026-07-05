# Story Intake

本模板包含四个分离产物。`User Story` 是产品价值主体；`Story Readiness`、`Story Business Confirmation` 和 `Delivery Consumption Boundary` 是 intake 输出，不属于 User Story 主体。

## User Story

- Schema marker: loom-user-story/v1

- Actor:
- Capability:
- Outcome:
- Business value:
- Out of scope:

## Product Context

- Vision / roadmap locator:
- Host issue / notes locator:
- Discussion summary locator:

## Acceptance Scenarios

Use business-readable GWT. These scenarios describe desired behavior, not implementation steps or test scripts.
Each scenario must have a stable scenario id and scenario locator so `spec.md` / `plan.md` can consume the scenario by reference without copying the story text.

### Scenario 1

- Scenario id: S1
- Scenario locator: .loom/stories/<item-id>.md#scenario-s1
- Dimension: happy_path

Given
- a clear product or system starting point

When
- the actor uses the target capability

Then
- the intended outcome is observable

### Scenario 2

- Scenario id: S2
- Scenario locator: .loom/stories/<item-id>.md#scenario-s2
- Dimension:
- `not_applicable` rationale, if this dimension does not apply:

Given
- a relevant variant, risk, or boundary condition

When
- the actor or system reaches that condition

Then
- the outcome still stays within the intended story boundary

## Story Readiness

- Schema marker: loom-story-readiness/v1

- Decision: confirmed | pending | revision-requested | not_applicable
- Rationale:
- Story locator:
- Missing inputs:
- Bypass rationale, if `not_applicable`:

## Story Business Confirmation

- Schema marker: loom-story-business-confirmation/v1

- Decision: pending | confirmed | revision-requested | not_applicable
- Business Confirmation locator: .loom/stories/<item-id>.md#story-business-confirmation
- Confirmed by:
- Confirmation source:
- Revision request:
- Bypass rationale, if `not_applicable`:
- Confirmation scope: actor, capability, outcome, business value, acceptance scenarios, out of scope.
- `pending` or `revision-requested` means formal spec / plan consumption must stop at the story locator.
- `not_applicable` must carry a rationale instead of a Business Confirmation locator.

## Delivery Consumption Boundary

- Schema marker: loom-story-delivery-mapping/v1

- Intended Work Item or FR:
- Scenario locator export: scenario ids and locators above, referenced only by locator from `spec.md` / `plan.md`
- Business Confirmation locator export: confirmed Business Confirmation locator or `not_applicable` rationale
- Spec entry expectation:
- Plan entry expectation:
- Story confirmation requirement: confirmed | not_applicable
- Story fields must not copy delivery handoff, recovery state, review findings, PR summary, merge-ready, closeout state, or formal spec / plan content.
