# #540 G0 baseline counterexamples

This note records a deterministic, browser-free reproduction against base
`4d0fb2ea2d8fef4f8c020766afaa5c19eff634fa` (`4d0fb2e`). It is evidence of the
pre-fix behavior only; it is not a post-fix acceptance result.

The temporary fake Playwright page supplied 160 visible controls and a short
body. Calling the then-current shared `Driver.snapshot(state)` produced only
128 controls, no cursor/continuation metadata, and disposed the handles from
the previous observation on the next snapshot. The same result exposed only
`role`, `name`, and `enabled`: standard label/name-source information,
`aria-describedby` description, bounded context, hints, and same-name
disambiguation were absent. A captured control was accepted by
`control_handle`/`locator` after its semantics changed as long as
`isConnected` stayed true; a replacement was the only identity change the
existing check could detect.

The fixed regression is
`playwright-shared-driver.test.ts` (`#540 G0 enumeration, semantics, identity,
and bounded waits in the shared driver`). On the unmodified base, its first
production call fails with:

```
TypeError: Driver.snapshot() takes 2 positional arguments but 3 were given
```

That failure is the baseline showing that the shared driver had no request
aware batch/continuation path. The regression is intentionally kept separate
from the later provider projection probe; neither result claims a live Chrome
or Camoufox run.
