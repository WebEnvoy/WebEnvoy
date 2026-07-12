# CORE-281 Plan

1. Parse the merged Lode runtime admission policy at the shared Core contract boundary.
2. Verify registry and operation truth agree before deciding admission.
3. Reject deferred BOSS policy before any Harbor call and retain XHS current admission.
4. Cover all task entrypoints, direct Core, three BOSS operations, policy drift, XHS success, and test-only fixtures.
5. Run targeted/full validation, current-head review, commit, push, and create a ready PR without merge or closeout.
