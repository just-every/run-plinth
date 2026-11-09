# Archive result boundaries

All focused attempts used exact product head d37a2e3e05bfb2be91fceda1c8bf38da19b726a2 with a clean product checkout. They are one-off evidence probes, not permanent tests or a Verify repair.

The first focused run completed real CLI export and import with exit 0. In the straight-line portion of collection-archive-probe-initial.mjs before its final journal call, every assertion passed: immutable review and exact source history; both 7500 and 45000 cent residuals; 10000 cents held retainage; 2000 cents unapplied remittance; original financial records unchanged; restored review authority off; old preview and captured consent refused; fresh receiving-owner review creates a new identity; restored sequences remain withheld; no incidental provider calls; current revocation refuses preview; and erasure refuses a captured request. Its overall exit is 1 because its extra later-journal command used an outside-checkout journal path and the CLI correctly returned safety_refusal, exit 4. This run does not establish the later-journal erasure_epoch check.

The second focused run corrected the journal path to the documented contained filename and kept the expected erasure_epoch refusal assertion. Its first import hit the unchanged 180-second per-operation diagnostic cutoff (child exit 143); later assertions were not reached.

The third one-off diagnostic allowed 600 seconds per CLI operation under the brief's 1200-second whole-probe hard limit. It failed during source export with transfer_failed and native_error: TypeError (child exit 1). The existing permanent portable test has not been weakened: all assertions and its 180-second subprocess limit remain unchanged.

The broad candidate archive test also failed: initial Node 24 export timeout, then exact Node 22.20.0 restore timeout. The same broad test on unchanged main 54fe2a1b63fa9465f9d84c98378f0e1fea1b7c8f failed during export with transfer_failed and native_error: TypeError. The baseline worktree had no tracked changes and was removed after its receipt was saved.

Native review recovery outcomes were executed and checked in the first exact-SHA run, but no fully successful standalone archive diagnostic or later-journal replay receipt is claimed. The independent fleet gate must rerun the permanent archive sanity test in its own environment. Existing Base transport failures are reported; no Base pin, copied module, timeout, assertion or guard is changed to conceal them.
