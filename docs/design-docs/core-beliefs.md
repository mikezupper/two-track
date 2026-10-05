# Core beliefs

The operating principles for anyone — human or agent — working in this repository. They are deliberately few, and each one has a mechanical enforcer or a named reviewer check.

1. **Reimplement small things; never import them.** A 30-line helper that lives in `src/` can be read, tested to 100%, and reasoned about in full. A dependency cannot. The library has zero runtime dependencies and the linter keeps it that way. (Enforced: `zero-runtime-deps`.)

2. **Keep the algebra in the type checker.** Every guarantee — sum types, exhaustiveness, brands, immutability — is expressed as a type and costs nothing at runtime. A construct that re-pays for a guarantee at runtime (`Object.freeze`, generators for bind, classes for method dispatch) is a measured regression, not a style choice. (Enforced: `no-freeze`, `no-generators`, `no-class`, `bench:check`.)

3. **Measure, then decide.** No performance claim enters a decision record or the README without a benchmark script in `bench/` and a row in `docs/references/benchmarks.md` that says how it was produced. (Reviewer check: every number in the README has a source row.)

4. **Make the fix part of the error.** Lint and structural-test messages end with `— fix: …`, because the reader is usually an agent that will apply it without further context. A rule that cannot say how to comply is not ready to be a rule. (Enforced: `scripts/invariants.ts` message format.)

5. **The repository is the only context that exists.** Decisions made in chat, in a review comment, or in someone's head are lost unless they land in `docs/`. When a conversation settles a question, the next commit records it as a decision or a plan entry. (Enforced: decisions must be indexed; active plans must have a decision log.)

6. **Boundaries are rigid; the inside is free.** Layer direction, the public encoding contract, and the banned-construct list are non-negotiable and mechanically checked. Within them, how a function is written is the author's call, and reviews do not relitigate style. (Enforced: `layer-direction`, `layer-registered`.)

7. **Parse at the boundary; trust the type inside.** Nothing past a decoder re-checks its input. If you feel the need to re-validate, the boundary is in the wrong place. (Reviewer check: no `as` on external data; no `typeof` guards in the domain.)

8. **Laws are tests.** A combinator ships with the property that proves its algebra (functor/monad laws, round-trips, peak-concurrency bounds). Example tests show the cases we thought of; properties attack the ones we did not. (Reviewer check: `test/*.test.ts` has a fast-check block per module.)

9. **Pay debt continuously.** Known gaps go in `docs/exec-plans/tech-debt-tracker.md` the day they are discovered, with the condition that would retire them. Small cleanup PRs are preferred over large ones.

10. **Honesty over marketing.** The README's "what you give up" table is maintained with the same care as the feature list. If a limitation is discovered, it is added there before any workaround is documented.
