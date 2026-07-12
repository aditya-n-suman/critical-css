# @critical-css/plugins

Lifecycle-hook Plugin SDK (AT-09).

- **Model** (ADR-0004): plugins are plain objects `{name, version, hooks}` — statically
  inspectable, no imperative registration. Contributions are strictly patch-based:
  frozen context in, typed patch out. The six named hooks are the ENTIRE surface.
- **Dispatch**: `PluginDispatcher.runHook(name, makeContext)` — declared configuration
  order, sequential; later plugins see earlier patches. Per-invocation timeout
  (default 5 s) and error isolation: a throwing plugin becomes an attributed
  `PLUGIN_FAILED` diagnostic, never an orchestrator crash (unless `failFast`).
- **Loader**: `buildPluginRegistry(candidates)` validates and rejects malformed
  plugins with diagnostics — never silently.
- **Reference plugins** (`examples.ts`, one per BRIEF §2.13 capability): ignore
  selectors, rewrite declarations, inject rules, custom visibility policy,
  force-include selectors.

Hook seams in `apps/cli`: `beforeLaunch → afterNavigation → beforeCollection →
afterCollection → beforeSerialize → afterSerialize`.
