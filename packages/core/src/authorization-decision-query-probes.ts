import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  authorizationEvaluationInput,
  environmentAuthorizationSubject,
  fixtureAuthorizationDecisionRef
} from "./authorization-decision-probe-fixtures.js";
import { createFileAuthorizationDecisionStore } from "./authorization-decision-store.js";
import { evaluateExecutionPolicy } from "./execution-policy.js";

async function assertOffsetPagination(directory: string): Promise<void> {
  const store = createFileAuthorizationDecisionStore({
    directory,
    clock: () => new Date("2026-07-21T02:00:00.000Z")
  });
  const decisions = [];
  for (const [key, evaluatedAt] of [
    ["offset-old", "2026-07-21T01:00:00.000+02:00"],
    ["offset-new-a", "2026-07-21T00:30:00.000Z"],
    ["offset-new-b", "2026-07-21T01:30:00.000+01:00"]
  ] as const) {
    decisions.push(await store.recordAuthorizationDecision({
      idempotency_key: key,
      evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ evaluatedAt })),
      subject: environmentAuthorizationSubject
    }));
  }
  const expected = decisions.slice(1).sort((left, right) => right.decision_ref.localeCompare(left.decision_ref));
  expected.push(decisions[0]!);
  const observed = [];
  let cursor: string | undefined;
  do {
    const page = await store.queryAuthorizationDecisions({ limit: 1, ...(cursor === undefined ? {} : { cursor }) });
    observed.push(...page.authorization_decisions);
    cursor = page.next_cursor ?? undefined;
  } while (cursor !== undefined);
  assert.deepEqual(observed.map((decision) => decision.decision_ref), expected.map((decision) => decision.decision_ref));
}

export async function probePaginationRestartAndCorruption(directory: string): Promise<void> {
  await assertOffsetPagination(join(directory, "offsets"));
  directory = join(directory, "bulk");
  const clock = () => new Date("2026-07-21T00:05:00.000Z");
  const store = createFileAuthorizationDecisionStore({ directory, clock });
  for (let index = 0; index < 105; index += 1) {
    const evaluatedAt = new Date(Date.parse("2026-07-21T00:00:00.000Z") + index * 1000).toISOString();
    await store.recordAuthorizationDecision({
      idempotency_key: `page-${index}`,
      evaluation: evaluateExecutionPolicy(authorizationEvaluationInput({ evaluatedAt })),
      subject: environmentAuthorizationSubject
    });
  }
  const first = await store.queryAuthorizationDecisions({ limit: 100 });
  assert.equal(first.authorization_decisions.length, 100);
  assert(first.next_cursor);
  const restarted = createFileAuthorizationDecisionStore({ directory, clock });
  const second = await restarted.queryAuthorizationDecisions({ limit: 100, cursor: first.next_cursor });
  assert.equal(second.authorization_decisions.length, 5);
  assert.equal(second.next_cursor, null);
  const refs = [...first.authorization_decisions, ...second.authorization_decisions].map((decision) => decision.decision_ref);
  assert.equal(new Set(refs).size, 105);
  await assert.rejects(() => restarted.queryAuthorizationDecisions({ cursor: `${first.next_cursor}x` }), /authorization_decision_cursor_invalid/);
  const cursorPayload = JSON.parse(Buffer.from(first.next_cursor, "base64url").toString("utf8")) as {
    observed_at: string;
    after_decided_at: string;
    after_decision_ref: string;
  };
  for (const tamperedCursor of [
    { ...cursorPayload, observed_at: "2026-07-21T00:06:00.000Z" },
    { ...cursorPayload, observed_at: "2026-07-21T00:04:59.000Z" },
    { ...cursorPayload, after_decision_ref: fixtureAuthorizationDecisionRef(999) }
  ]) {
    const encoded = Buffer.from(JSON.stringify(tamperedCursor), "utf8").toString("base64url");
    await assert.rejects(() => restarted.queryAuthorizationDecisions({ cursor: encoded }), /authorization_decision_cursor_invalid/);
  }
  const [journalFile] = (await readdir(directory)).filter((file) => file.endsWith(".json"));
  const journalPath = join(directory, journalFile!);
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as { decisions: Array<{ decision: Record<string, unknown> }> };
  journal.decisions[0]!.decision.raw_dom = "forbidden";
  await writeFile(journalPath, JSON.stringify(journal), "utf8");
  await assert.rejects(() => restarted.queryAuthorizationDecisions(), /authorization_decision_journal_invalid/);
}
