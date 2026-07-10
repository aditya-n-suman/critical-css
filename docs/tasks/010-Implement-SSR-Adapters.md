# 010 — Implement SSR Adapters

## Title

**Implement `packages/ssr`: Common Adapter Core Plus Six Framework-Specific Adapters**

## Package/Module

`packages/ssr` (Phase 11, SSR Integration). Owns the framework-agnostic core primitives (`resolveRouteKey`, `lookupCriticalCss`, `injectIntoHead`, `deferFullStylesheet`) plus six thin framework-specific shims: React SSR, Express, Next.js, Astro, Remix, Fastify.

## Depends-On

- `packages/cache` (task 007 — specifically ../design/803-Route-Cache.md's route-keyed lookup, which the core's `lookupCriticalCss` primitive reads from at request time or build time).
- ../design/606-Output-Formats.md (the `inline-<style>` payload this layer injects verbatim; consumed, not defined, here).
- BRIEF.md Section 2.9 (Route Manifest) and Section 2.10 (SSR Integration).

## Design Doc Reference

../design/900-SSR-Overview.md (the common adapter contract), and its six framework-specific siblings 901–906 (React SSR, Express, Next.js, Astro, Remix, Fastify), all implemented here as one core package plus six shims.

## Overview

This task builds `packages/ssr` as a thin, framework-agnostic core plus six thin framework-specific shims, stateless per request except for the cache handle it holds (900 §7) — a property that matters because SSR servers handle thousands of concurrent requests and any per-request mutable shared state is a data-race liability. The four logical steps (resolve route → look up cache → inject into head → defer full stylesheet) are identical across both operating modes — build-time injection (SSG) and request-time injection (SSR/dynamic) — and across all six frameworks (900 §7, steps 1–4). Conflating the two modes is, per 900, the most common integration error; this task's tests must exercise both explicitly, not only one.

Because 901–906 are siblings this overview delegates to but does not itself specify algorithmically, this task's scope includes implementing all six framework adapters' actual attachment mechanics (React `renderToString`/`renderToPipeableStream` streaming-shell injection, Express `res.write`/`res.end` interception, Next.js App/Pages Router integration, Astro integration hook, Remix `entry.server` `handleRequest`, Fastify `onSend` hook) — not merely the shared core with adapters stubbed to a single reference framework.

## Acceptance Criteria

- The four core primitives (`resolveRouteKey`, `lookupCriticalCss`, `injectIntoHead`, `deferFullStylesheet`) are implemented in `packages/ssr`'s framework-agnostic core and are the sole implementation each of the six shims calls into — no shim reimplements route resolution or cache lookup independently.
- `resolveRouteKey` correctly resolves both exact-match and glob-pattern route manifest entries (e.g., `"/blog/*": "blog.css"`) per BRIEF.md §2.9.
- A cache hit yields a ready-to-inline `inline-<style>` payload plus the full-stylesheet URL; a cache miss triggers the documented miss policy (900 §12) rather than injecting nothing silently or crashing the request.
- Injected critical CSS appears in the first flushed HTML chunk, correctly ordered relative to other head content, for both build-time and request-time modes — verified by a test per mode.
- The full stylesheet `<link>` is emitted/rewritten as non-render-blocking (async-loading) in every adapter's output, while still applying before interaction (no FOUC on a correct hit).
- All six framework adapters (901–906) are implemented against real instances of their respective frameworks (not mocked framework internals) and each has at least one passing end-to-end test: request/build in, correct head-injected HTML out.
- Route ambiguity and cache-miss edge cases (900 Edge Cases) are handled per the documented policy and produce a diagnostic, never a silent wrong-route injection (Principle 6, Fail Fast).
- No adapter introduces per-request shared mutable state; a concurrency test (many simulated concurrent requests to the same adapter instance) shows no cross-request data leakage.
- A TTFB budget test demonstrates the request-time cache lookup adds negligible latency (per 900's performance framing) on a hot cache.

## Estimated Complexity

**L** — one shared core plus six genuinely different framework integration surfaces (three distinct streaming/lifecycle models: React streaming, Express middleware, Next.js dual-router, Astro build hooks, Remix `entry.server`, Fastify `onSend`), each needing its own end-to-end test against the real framework.

## Notes on Scope Boundaries

The recurring implementation trap this task must avoid, per 900 §7's explicit warning, is **conflating build-time and request-time injection**. They share the same four core primitives but have materially different cost and failure profiles: build-time injection runs once per route per build inside a pre-render step and can afford to fail loudly and halt the build on a miss, while request-time injection runs on every live HTTP response and must have a documented, non-crashing miss policy (900 §12) because a production server cannot halt mid-response. An adapter that implements only one mode and silently assumes the other "just works the same way" does not satisfy this task — each of the six framework adapters must state, and be tested against, which mode(s) it supports (some frameworks, like Astro's static output, are primarily build-time; others, like raw Express, are primarily request-time; several, like Next.js, support both and must be tested in both).

A second boundary: this task consumes `packages/cache`'s route cache (803) and `packages/serializer`'s output-format contract (606) as fixed, opaque inputs. It must not reach into either package's internals — e.g., no adapter should re-derive a fingerprint or re-run the serialization pipeline to "double check" a cache entry at request time. Trusting the cache's fingerprint-equals-correctness guarantee (established by task 007) is what keeps the request-time path's added latency negligible.

## Definition of Done

Satisfies ../implementation/004-Definition-of-Done.md in full, at the "New module implementation" applicability level (Section 8.2): Gates 1–7, including integration tests against `packages/cache`'s route cache (Gate 3, crosses boundary by construction), visual/behavioral verification that no FOUC occurs on a correct hit (Gate 5), and doc updates to 900–906 if any adapter's implementation surfaces a divergence from the documented contract.
