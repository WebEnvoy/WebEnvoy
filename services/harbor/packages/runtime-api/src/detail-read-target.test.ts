import assert from "node:assert/strict";
import test from "node:test";
import { DetailReadTargetStore, isCanonicalDetailUrl } from "./detail-read-target.js";

test("accepts only canonical same-site detail targets", () => {
  assert.equal(isCanonicalDetailUrl("xiaohongshu", "https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_source=pc_search"), true);
  assert.equal(isCanonicalDetailUrl("boss", "https://www.zhipin.com/job_detail/AbC_123.html"), true);
  for (const value of [
    "https://evil.example/explore/0123456789abcdef01234567",
    "https://www.xiaohongshu.com/publish/0123456789abcdef01234567",
    "https://www.xiaohongshu.com/explore/not-an-id",
    "https://www.zhipin.com/job_detail/AbC.html?chat=1",
    "https://www.zhipin.com/web/geek/job"
  ]) assert.equal(isCanonicalDetailUrl(value.includes("zhipin") ? "boss" : "xiaohongshu", value), false);
});

test("binds opaque detail refs to one session, site, operation, ttl, and consumption", () => {
  const store = new DetailReadTargetStore();
  const [detailRef] = store.register({
    runtime_session_ref: "session_a",
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/AbC_123.html" }],
    now: 1_000
  });
  assert.ok(detailRef);
  assert.equal(store.consume({ detail_ref: detailRef, runtime_session_ref: "session_b", site_id: "boss", operation_id: "boss_read_job_detail", now: 2_000 }), "detail_ref_binding_mismatch");
  const consumed = store.consume({ detail_ref: detailRef, runtime_session_ref: "session_a", site_id: "boss", operation_id: "boss_read_job_detail", now: 2_000 });
  assert.equal(typeof consumed, "object");
  const internalRecords = (store as unknown as { records: Map<string, unknown> }).records;
  assert.equal(internalRecords.has(detailRef), false);
  assert.equal(JSON.stringify(store).includes("AbC_123"), false);
  assert.equal(store.consume({ detail_ref: detailRef, runtime_session_ref: "session_a", site_id: "boss", operation_id: "boss_read_job_detail", now: 2_001 }), "detail_ref_consumed");

  const [xhsRef] = store.register({
    runtime_session_ref: "session_a",
    site_id: "xiaohongshu",
    search_operation_id: "xhs_search_notes",
    targets: [{ canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567?xsec_token=private-navigation-token&xsec_source=pc_search" }],
    now: 2_000
  });
  const xhsTarget = store.consume({ detail_ref: xhsRef, runtime_session_ref: "session_a", site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", now: 2_001 });
  assert.equal(typeof xhsTarget === "object" && xhsTarget.canonical_url.includes("private-navigation-token"), true);
  assert.equal(JSON.stringify(store).includes("private-navigation-token"), false);

  const [expired] = store.register({
    runtime_session_ref: "session_a",
    site_id: "xiaohongshu",
    search_operation_id: "xhs_search_notes",
    targets: [{ canonical_url: "https://www.xiaohongshu.com/explore/0123456789abcdef01234567" }],
    now: 1_000
  });
  assert.equal(store.consume({ detail_ref: expired, runtime_session_ref: "session_a", site_id: "xiaohongshu", operation_id: "xhs_read_note_detail", now: 1_000 + 10 * 60 * 1000 }), "detail_ref_expired");
});

test("bounds tombstones and clears active refs with the session lifecycle", () => {
  const store = new DetailReadTargetStore();
  const [releasedRef] = store.register({
    runtime_session_ref: "session_release",
    site_id: "boss",
    search_operation_id: "boss_job_search",
    targets: [{ canonical_url: "https://www.zhipin.com/job_detail/Release_1.html" }],
    now: 1_000
  });
  store.clearSession("session_release", 2_000);
  assert.equal(store.consume({ detail_ref: releasedRef, runtime_session_ref: "session_release", site_id: "boss", operation_id: "boss_read_job_detail", now: 2_001 }), "detail_ref_expired");
  assert.equal((store as unknown as { records: Map<string, unknown> }).records.size, 0);

  for (let index = 0; index < 4_200; index += 1) {
    const [detailRef] = store.register({
      runtime_session_ref: "session_volume",
      site_id: "boss",
      search_operation_id: "boss_job_search",
      targets: [{ canonical_url: `https://www.zhipin.com/job_detail/Volume_${index}.html` }],
      now: 3_000 + index
    });
    assert.equal(typeof store.consume({ detail_ref: detailRef, runtime_session_ref: "session_volume", site_id: "boss", operation_id: "boss_read_job_detail", now: 3_000 + index }), "object");
  }
  const tombstones = (store as unknown as { tombstones: Map<string, unknown> }).tombstones;
  assert.equal(tombstones.size, 4_096);
  store.clearSession("session_volume", 3_000 + 10 * 60 * 1_000 + 4_200);
  assert.equal(tombstones.size, 0);
});
