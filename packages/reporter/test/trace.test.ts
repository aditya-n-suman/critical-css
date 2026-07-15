/**
 * Extraction trace unit tests (M5, docs/design/1003-Tracing.md, AT-10).
 */

import { describe, expect, it } from 'vitest'
import { buildExtractionTrace, withSerializationStage } from '../src/trace.js'
import type { DependencyGraphReport, MatchedSelectorRow, UnmatchedSelectorRow } from '../src/reports.js'

const matched: MatchedSelectorRow[] = [
  { selectorText: '.hero .cta', stylesheetHref: 'https://x.test/app.css', ruleIndexPath: [0], matchedNodeCount: 1 },
]
const unmatched: UnmatchedSelectorRow[] = [
  { selectorText: '.legacy-banner', stylesheetHref: 'https://x.test/app.css', ruleIndexPath: [1] },
]
const dependencyGraph: DependencyGraphReport = {
  nodes: [{ id: 'font:Inter', type: 'font-face', value: 'Inter' }],
  edges: [{ from: 'rule:0:0', to: 'font:Inter', kind: 'font-family' }],
}

function trace() {
  return buildExtractionTrace({
    runId: 'run-desktop',
    route: '/products',
    viewportProfileId: 'desktop',
    timing: [
      { stage: 'navigate', elapsedMs: 50 },
      { stage: 'collect', elapsedMs: 20 },
      { stage: 'match', elapsedMs: 10 },
      { stage: 'resolve', elapsedMs: 5 },
    ],
    matchedSelectors: matched,
    unmatchedSelectors: unmatched,
    dependencyGraph,
    assembledAt: 1_000,
  })
}

describe('buildExtractionTrace (1003 §8.1 Span model)', () => {
  it('produces a flat span list with a run→route→viewport→stage nesting', () => {
    const { spans } = trace()
    const byKind = (k: string) => spans.filter((s) => s.kind === k)
    expect(byKind('run')).toHaveLength(1)
    expect(byKind('route')).toHaveLength(1)
    expect(byKind('viewport')).toHaveLength(1)
    expect(byKind('stage')).toHaveLength(4)

    const run = byKind('run')[0]!
    const route = byKind('route')[0]!
    const viewport = byKind('viewport')[0]!
    expect(route.parentSpanId).toBe(run.spanId)
    expect(viewport.parentSpanId).toBe(route.spanId)
    for (const stage of byKind('stage')) expect(stage.parentSpanId).toBe(viewport.spanId)
  })

  it('every span shares one traceId derived deterministically from runId', () => {
    const { spans } = trace()
    const traceIds = new Set(spans.map((s) => s.traceId))
    expect(traceIds.size).toBe(1)
    expect([...traceIds][0]).toMatch(/^[0-9a-f]{32}$/)
    // Deterministic: rebuilding from the same runId reproduces the same traceId.
    const again = trace()
    expect(again.spans[0]?.traceId).toBe(spans[0]?.traceId)
  })

  it('spanIds are deterministic (stable across rebuilds, not random)', () => {
    const a = trace()
    const b = trace()
    expect(a.spans.map((s) => s.spanId)).toEqual(b.spans.map((s) => s.spanId))
  })

  it('stage spans carry the real, measured elapsedMs as cumulative offsets', () => {
    const { spans } = trace()
    const navigate = spans.find((s) => s.kind === 'stage' && s.name === 'navigate')!
    const collect = spans.find((s) => s.kind === 'stage' && s.name === 'collect')!
    expect(navigate.startTime).toBe(1_000)
    expect(navigate.endTime).toBe(1_050)
    expect(collect.startTime).toBe(1_050)
    expect(collect.endTime).toBe(1_070)
  })

  it('attaches a rule.matched decision event per matched selector, nested under the match stage', () => {
    const { spans } = trace()
    const matchStage = spans.find((s) => s.kind === 'stage' && s.name === 'match')!
    const decision = spans.find(
      (s) => s.kind === 'decision' && s.events.some((e) => e.name === 'rule.matched'),
    )!
    expect(decision.parentSpanId).toBe(matchStage.spanId)
    expect(decision.events[0]?.attributes['selector']).toBe('.hero .cta')
    expect(decision.events[0]?.attributes['matchedElementCount']).toBe(1)
  })

  it('attaches a rule.excluded decision event per unmatched selector — no fabricated visibilityReason/cacheHit', () => {
    const { spans } = trace()
    const decision = spans.find((s) => s.kind === 'decision' && s.events.some((e) => e.name === 'rule.excluded'))!
    const event = decision.events[0]!
    expect(event.attributes['selector']).toBe('.legacy-banner')
    expect(event.attributes['matchedElementCount']).toBe(0)
    expect(event.attributes).not.toHaveProperty('visibilityReason')
    expect(event.attributes).not.toHaveProperty('cacheHit')
  })

  it('attaches a dependency.included decision event per dependency-graph edge, nested under resolve', () => {
    const { spans } = trace()
    const resolveStage = spans.find((s) => s.kind === 'stage' && s.name === 'resolve')!
    const decision = spans.find(
      (s) => s.kind === 'decision' && s.events.some((e) => e.name === 'dependency.included'),
    )!
    expect(decision.parentSpanId).toBe(resolveStage.spanId)
    expect(decision.events[0]?.attributes).toEqual({
      edgeType: 'font-family',
      sourceRule: 'rule:0:0',
      targetRule: 'font:Inter',
    })
  })

  it('every attribute/event-attribute value is an OTel-primitive (string | number | boolean)', () => {
    const { spans } = trace()
    for (const span of spans) {
      for (const value of Object.values(span.attributes)) {
        expect(['string', 'number', 'boolean']).toContain(typeof value)
      }
      for (const event of span.events) {
        for (const value of Object.values(event.attributes)) {
          expect(['string', 'number', 'boolean']).toContain(typeof value)
        }
      }
    }
  })

  it('degrades gracefully with no decision spans when there are zero matched/unmatched/edges', () => {
    const empty = buildExtractionTrace({
      runId: 'run-x',
      route: '/',
      viewportProfileId: 'desktop',
      timing: [],
      matchedSelectors: [],
      unmatchedSelectors: [],
      dependencyGraph: { nodes: [], edges: [] },
      assembledAt: 0,
    })
    expect(empty.spans.filter((s) => s.kind === 'decision')).toHaveLength(0)
    expect(empty.spans.filter((s) => s.kind === 'stage')).toHaveLength(0)
    // run/route/viewport spans are still present (1003 §12: "a missing span
    // is indistinguishable from a crash, whereas a present, brief span is
    // unambiguous" — applied here to the always-present container spans).
    expect(empty.spans).toHaveLength(3)
  })

  it('serializes to JSON (the OTLP-adjacent local export target, 1003 §11)', () => {
    const { spans } = trace()
    expect(() => JSON.parse(JSON.stringify(spans))).not.toThrow()
  })

  it('closes every span — never endTime: undefined (1003 §10.1, A3)', () => {
    const { spans } = trace()
    for (const span of spans) {
      expect(span.endTime).toBeDefined()
      expect(span.endTime as number).toBeGreaterThanOrEqual(span.startTime)
    }
  })

  it('closes the run/route/viewport container spans even with zero stages/decisions', () => {
    const empty = buildExtractionTrace({
      runId: 'run-x',
      route: '/',
      viewportProfileId: 'desktop',
      timing: [],
      matchedSelectors: [],
      unmatchedSelectors: [],
      dependencyGraph: { nodes: [], edges: [] },
      assembledAt: 42,
    })
    for (const span of empty.spans) {
      expect(span.endTime).toBeDefined()
      expect(span.endTime).toBe(42)
    }
  })
})

describe('withSerializationStage (cross-viewport serialization stage attribution)', () => {
  it('attaches a serialize stage span parented at the route span', () => {
    const bundle = { route: '/products', extractionTrace: trace() }
    const enriched = withSerializationStage(bundle, 15, 2_000)
    const routeSpan = enriched.extractionTrace.spans.find((s) => s.kind === 'route')!
    const serializeSpan = enriched.extractionTrace.spans.find((s) => s.kind === 'stage' && s.name === 'serialize')!
    expect(serializeSpan.parentSpanId).toBe(routeSpan.spanId)
    expect(serializeSpan.attributes['elapsedMs']).toBe(15)
    expect(serializeSpan.endTime).toBe(2_015)
  })

  it('extends the route/run span endTime to cover a later-ending serialize stage (A3: child never outlives parent)', () => {
    const bundle = { route: '/products', extractionTrace: trace() }
    const enriched = withSerializationStage(bundle, 15, 2_000)
    const routeSpan = enriched.extractionTrace.spans.find((s) => s.kind === 'route')!
    const runSpan = enriched.extractionTrace.spans.find((s) => s.kind === 'run')!
    expect(routeSpan.endTime).toBe(2_015)
    expect(runSpan.endTime).toBe(2_015)
  })

  it('every span stays closed after enrichment', () => {
    const bundle = { route: '/products', extractionTrace: trace() }
    const enriched = withSerializationStage(bundle, 15, 2_000)
    for (const span of enriched.extractionTrace.spans) {
      expect(span.endTime).toBeDefined()
      expect(span.endTime as number).toBeGreaterThanOrEqual(span.startTime)
    }
  })

  it('does not mutate the input bundle (pure sink discipline)', () => {
    const bundle = { route: '/products', extractionTrace: trace() }
    const before = bundle.extractionTrace.spans.length
    withSerializationStage(bundle, 15, 2_000)
    expect(bundle.extractionTrace.spans.length).toBe(before)
  })
})
