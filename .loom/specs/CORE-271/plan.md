# CORE-271 Plan

1. Trace every post-session return and persistence boundary in `submitRuntimeTask`.
2. Add exact owner/holder-verified release with stop fallback and fail-closed cleanup classification.
3. Abort timed operations, release before terminal projection, and recover interrupted non-terminal runs during API startup.
4. Add focused fault injection and process restart regression coverage.
5. Run targeted/full checks, review, commit, push, and create a ready PR without merge or closeout.
