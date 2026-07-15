/**
 * Dev-mode server (docs/design/1005-Debug-UI.md §7.3 "Dev mode": a local
 * server, bound to `localhost` by default per §11, that reads a
 * `--report-dir` and serves the view set from §8.3).
 *
 * Scope cuts vs 1005 (disclosed here and in README):
 *   - No `CacheStore`/`CacheAdapter` (§8.4) — this app never reads
 *     `packages/cache` directly; every fact comes from `--report-dir` JSON
 *     via `adapters/report-store.ts` (see that file's own header comment).
 *   - No live filesystem polling (§7.3, §12 "concurrent extraction writes")
 *     — each request re-scans `reportDir` fresh (cheap for a debug tool at
 *     this milestone's expected scale), which is simpler than a poll loop
 *     and still shows new runs on the next request/refresh, just not
 *     push-updated.
 *   - No `RerunTrigger` (§8.2) — the "trigger re-run" subprocess affordance
 *     is not implemented this session; see README "Scope cuts".
 *   - Server-rendered HTML with plain forms for filtering (picker) rather
 *     than a client-side JS app — every view in §8.3 is still present, just
 *     rendered per-request rather than via a client-side router/JS bundle.
 *     This keeps the server dependency-free (no bundler, no framework).
 *
 * Security (1005 §12 "path traversal via a crafted fingerprint or route
 * parameter"): the `:id` route parameter is looked up against the in-memory
 * `RunRecord[]` produced by `loadReportDir` — it is NEVER used to build a
 * filesystem path directly from request input, so path traversal via a
 * crafted id is structurally impossible (the id must match a `RunRecord.id`
 * already discovered by the reportDir walk, itself confined to `reportDir`).
 */

import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { loadReportDir } from './adapters/report-store.js'
import { buildRunIndex, filterRunIndex, type RunFilter } from './viewmodel/run-index.js'
import { buildMatchedRuleGroups } from './viewmodel/matched-rules.js'
import { buildUnmatchedRuleGroups } from './viewmodel/unmatched-selectors.js'
import { layoutDependencyGraph } from './viewmodel/dependency-graph.js'
import { buildWaterfall } from './viewmodel/waterfall.js'
import { buildCriticalHtml } from './viewmodel/side-by-side.js'
import { buildOverlayHtml } from './overlay.js'
import type { RunRecord } from './types.js'

export interface ServeOptions {
  readonly reportDir: string
  /**
   * Optional directory of serialized critical-CSS output files (what
   * `apps/cli --out-dir` writes), keyed by the same relative path as the
   * report file minus its `.report.json` suffix. Powers the side-by-side
   * view's critical-CSS pane (1005 §8.3.2) — omit to get that view's
   * disclosed degraded state.
   */
  readonly cssDir?: string
  readonly host?: string
  readonly port?: number
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — critical-css visualizer</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, sans-serif; margin: 0; padding: 24px; max-width: 1100px; }
  h1 { font-size: 20px; }
  nav a { margin-right: 12px; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
  th, td { border: 1px solid #ccc; padding: 4px 8px; text-align: left; }
  .banner { border: 1px dashed #999; border-radius: 6px; padding: 12px; font-size: 13px; margin: 12px 0; }
  form.filters input, form.filters select { margin-right: 8px; }
  iframe.render { width: 100%; height: 480px; border: 1px solid #999; border-radius: 6px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .bar { background: #2e6fda; height: 18px; border-radius: 3px; color: #fff; font-size: 11px; padding-left: 4px; }
  .bar-row { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
  .bar-row .label { width: 140px; font-size: 12px; }
  code { font-family: ui-monospace, monospace; }
</style>
</head>
<body>${body}</body>
</html>`
}

async function loadRuns(reportDir: string): Promise<readonly RunRecord[]> {
  const { runs, skipped } = await loadReportDir(reportDir)
  if (skipped.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[visualizer] skipped ${skipped.length} unparsable report file(s):`, skipped)
  }
  return runs
}

function findRun(runs: readonly RunRecord[], id: string): RunRecord | undefined {
  return runs.find((r) => r.id === id)
}

function renderPicker(runs: readonly RunRecord[], filter: RunFilter): string {
  const index = filterRunIndex(buildRunIndex(runs), filter)
  const rows = index
    .map((r) => {
      const record = runs.find((run) => run.route === r.route && run.viewportProfileId === r.viewportProfileId)
      const href = record !== undefined ? `/run/${encodeURIComponent(record.id)}` : '#'
      return `<tr>
        <td><a href="${href}">${escapeHtml(r.route)}</a></td>
        <td>${escapeHtml(r.viewportProfileId)}</td>
        <td>${escapeHtml(r.mode)}</td>
        <td>${r.matchedCount}</td>
        <td>${r.unmatchedCount}</td>
        <td>${r.totalTimingMs}ms</td>
        <td>${r.dependencyNodeCount}/${r.dependencyEdgeCount}</td>
      </tr>`
    })
    .join('\n')
  return page(
    'Runs',
    `
    <h1>Route / viewport picker</h1>
    <p class="banner">1005 §8.3.1. No cache-store staleness/regression flags — this milestone's adapter reads only
    <code>--report-dir</code> JSON, not <code>CacheStore</code> (see README "Scope cuts").</p>
    <form class="filters" method="get" action="/">
      <input type="text" name="route" placeholder="route contains…" value="${escapeHtml(filter.routeQuery ?? '')}" />
      <input type="text" name="viewport" placeholder="viewport id" value="${escapeHtml(filter.viewportProfileId ?? '')}" />
      <input type="text" name="mode" placeholder="mode" value="${escapeHtml(filter.mode ?? '')}" />
      <button type="submit">Filter</button>
    </form>
    <table>
      <thead><tr><th>Route</th><th>Viewport</th><th>Mode</th><th>Matched</th><th>Unmatched</th><th>Timing</th><th>Dep nodes/edges</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7">No runs found under this report-dir.</td></tr>'}</tbody>
    </table>
  `,
  )
}

function renderDetail(run: RunRecord): string {
  const base = `/run/${encodeURIComponent(run.id)}`
  return page(
    `${run.route} (${run.viewportProfileId})`,
    `
    <h1>${escapeHtml(run.route)} — ${escapeHtml(run.viewportProfileId)} / ${escapeHtml(run.mode)}</h1>
    <nav>
      <a href="/">&laquo; picker</a>
      <a href="${base}/matched">Matched/unmatched selectors</a>
      <a href="${base}/graph">Dependency graph</a>
      <a href="${base}/waterfall">Timing waterfall</a>
      <a href="${base}/side-by-side">Side-by-side render</a>
      <a href="${base}/overlay">Fold overlay (1004)</a>
    </nav>
    <p>Report file: <code>${escapeHtml(run.reportFilePath)}</code></p>
  `,
  )
}

function renderMatched(run: RunRecord): string {
  const matched = buildMatchedRuleGroups(run.bundle.matchedSelectors.rows)
  const unmatched = buildUnmatchedRuleGroups(run.bundle.unmatchedSelectors.rows)
  const matchedHtml = matched
    .map(
      (g) => `<details open><summary>${escapeHtml(g.stylesheetHref ?? '(inline)')} — ${g.rows.length} matched, ${g.totalMatchedNodes} nodes</summary>
      <table><thead><tr><th>Selector</th><th>Matched nodes</th></tr></thead><tbody>
      ${g.rows.map((r) => `<tr><td><code>${escapeHtml(r.selectorText)}</code></td><td>${r.matchedNodeCount}</td></tr>`).join('')}
      </tbody></table></details>`,
    )
    .join('\n')
  const unmatchedHtml = unmatched
    .map(
      (g) => `<details><summary>${escapeHtml(g.stylesheetHref ?? '(inline)')} — ${g.rows.length} unmatched</summary>
      <table><thead><tr><th>Selector</th><th>Hint</th></tr></thead><tbody>
      ${g.rows.map((r) => `<tr><td><code>${escapeHtml(r.selectorText)}</code></td><td>${escapeHtml(r.hint)}</td></tr>`).join('')}
      </tbody></table></details>`,
    )
    .join('\n')
  return page(
    'Matched/unmatched selectors',
    `<h1>Matched (${run.bundle.matchedSelectors.count}) / unmatched (${run.bundle.unmatchedSelectors.count}) selectors</h1>
    <nav><a href="/run/${encodeURIComponent(run.id)}">&laquo; run</a></nav>
    <h2>Matched</h2>${matchedHtml || '<p>none</p>'}
    <h2>Unmatched</h2>${unmatchedHtml || '<p>none</p>'}`,
  )
}

function renderGraph(run: RunRecord): string {
  const layout = layoutDependencyGraph(run.bundle.dependencyGraph)
  const width = Math.max(600, ...layout.positions.map((p) => p.x + 160))
  const height = Math.max(200, ...layout.positions.map((p) => p.y + 60))
  const posById = new Map(layout.positions.map((p) => [p.id, p]))
  const lines = layout.edges
    .map((e) => {
      const from = posById.get(e.from)
      const to = posById.get(e.to)
      if (from === undefined || to === undefined) return ''
      return `<line x1="${from.x + 60}" y1="${from.y + 15}" x2="${to.x + 60}" y2="${to.y + 15}" stroke="#999" stroke-width="1" />`
    })
    .join('')
  const nodes = layout.positions
    .map(
      (p) =>
        `<g transform="translate(${p.x},${p.y})"><rect width="120" height="30" rx="4" fill="#2e6fda" /><text x="60" y="19" text-anchor="middle" font-size="10" fill="#fff">${escapeHtml(p.id)}</text></g>`,
    )
    .join('')
  return page(
    'Dependency graph',
    `<h1>Dependency graph</h1>
    <nav><a href="/run/${encodeURIComponent(run.id)}">&laquo; run</a></nav>
    ${layout.cycleDetected ? '<p class="banner">Cycle detected — see 1005 §10.2 "Failure cases". Nodes not resolved topologically are laid out at layer 0.</p>' : ''}
    ${layout.collapsed ? '<p class="banner">Graph exceeds the collapse threshold; rendered uncollapsed (clustering not implemented this session — see README "Scope cuts").</p>' : ''}
    <svg width="${width}" height="${height}" style="background:#f7f7f7; border:1px solid #ccc; border-radius:6px;">${lines}${nodes}</svg>`,
  )
}

function renderWaterfall(run: RunRecord): string {
  const wf = buildWaterfall(run.bundle.extractionTrace.spans)
  const scale = wf.totalMs > 0 ? 600 / wf.totalMs : 1
  const rows = wf.rows
    .map(
      (r) =>
        `<div class="bar-row"><span class="label">${escapeHtml(r.name)}</span>
        <div style="margin-left:${r.startOffsetMs * scale}px" class="bar" style="width:${Math.max(2, r.durationMs * scale)}px">${r.durationMs}ms</div>
        <span>${r.decisionCount > 0 ? `(${r.decisionCount} decisions)` : ''}</span></div>`,
    )
    .join('\n')
  return page(
    'Timing waterfall',
    `<h1>Timing waterfall (total ${wf.totalMs}ms)</h1>
    <nav><a href="/run/${encodeURIComponent(run.id)}">&laquo; run</a></nav>
    ${rows || '<p>No stage spans in this run\'s trace.</p>'}`,
  )
}

async function fetchPageHtml(route: string): Promise<string | null> {
  try {
    const res = await fetch(route)
    if (!res.ok) return null
    return await res.text()
  } catch {
    return null
  }
}

async function loadCriticalCss(cssDir: string | undefined, run: RunRecord, reportDir: string): Promise<string | null> {
  if (cssDir === undefined) return null
  const rel = relative(reportDir, run.reportFilePath).replace(/\.report\.json$/, '')
  try {
    return await readFile(join(cssDir, rel), 'utf8')
  } catch {
    return null
  }
}

async function renderSideBySide(run: RunRecord, cssDir: string | undefined, reportDir: string): Promise<string> {
  const pageHtml = await fetchPageHtml(run.route)
  const criticalCss = await loadCriticalCss(cssDir, run, reportDir)
  if (pageHtml === null) {
    return page(
      'Side-by-side',
      `<h1>Side-by-side render</h1>
      <nav><a href="/run/${encodeURIComponent(run.id)}">&laquo; run</a></nav>
      <p class="banner">Could not fetch <code>${escapeHtml(run.route)}</code> live — this view renders a real fetch of the
      route at request time (1005 §8.3.2 "the same HTML"), never a stored copy, so it degrades honestly when the origin
      is unreachable (e.g. an ephemeral test server that has since exited).</p>`,
    )
  }
  const criticalResult = criticalCss !== null ? buildCriticalHtml(pageHtml, criticalCss) : null
  return page(
    'Side-by-side',
    `<h1>Side-by-side: full CSS vs critical CSS</h1>
    <nav><a href="/run/${encodeURIComponent(run.id)}">&laquo; run</a></nav>
    ${criticalCss === null ? '<p class="banner">No --css-dir configured (or no matching file found) — showing full-CSS pane only. Pass --css-dir pointing at the CLI\'s --out-dir to populate the critical-CSS pane.</p>' : ''}
    <div class="grid-2">
      <div><h2>Full CSS</h2><iframe class="render" title="full css" sandbox="allow-same-origin" srcdoc="${escapeHtml(pageHtml)}"></iframe></div>
      <div><h2>Critical CSS only</h2>${
        criticalResult !== null
          ? `<iframe class="render" title="critical css" sandbox="allow-same-origin" srcdoc="${escapeHtml(criticalResult.html)}"></iframe>`
          : '<p>(unavailable)</p>'
      }</div>
    </div>`,
  )
}

async function renderOverlay(run: RunRecord): Promise<string> {
  const pageHtml = await fetchPageHtml(run.route)
  const html = buildOverlayHtml(run.bundle, pageHtml !== null ? { pageHtml } : {})
  return page(
    'Fold overlay',
    `<h1>Fold overlay (1004, embedded)</h1>
    <nav><a href="/run/${encodeURIComponent(run.id)}">&laquo; run</a></nav>
    <iframe class="render" style="height:900px" title="fold overlay" sandbox="allow-same-origin" srcdoc="${escapeHtml(html)}"></iframe>`,
  )
}

function notFound(res: ServerResponse, message: string): void {
  res.statusCode = 404
  res.setHeader('content-type', 'text/html; charset=utf-8')
  res.end(page('Not found', `<h1>Not found</h1><p>${escapeHtml(message)}</p><p><a href="/">&laquo; picker</a></p>`))
}

export function createVisualizerServer(options: ServeOptions): Server {
  const { reportDir, cssDir } = options
  return createServer((req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const runs = await loadRuns(reportDir)

      if (url.pathname === '/') {
        const routeQuery = url.searchParams.get('route')
        const viewportProfileId = url.searchParams.get('viewport')
        const mode = url.searchParams.get('mode')
        res.setHeader('content-type', 'text/html; charset=utf-8')
        res.end(
          renderPicker(runs, {
            ...(routeQuery !== null ? { routeQuery } : {}),
            ...(viewportProfileId !== null && viewportProfileId !== '' ? { viewportProfileId } : {}),
            ...(mode !== null && mode !== '' ? { mode } : {}),
          }),
        )
        return
      }

      const match = /^\/run\/([^/]+)(\/[a-z-]+)?$/.exec(url.pathname)
      if (match === null) {
        notFound(res, `No route for ${url.pathname}`)
        return
      }
      const id = decodeURIComponent(match[1] ?? '')
      const run = findRun(runs, id)
      if (run === undefined) {
        notFound(res, `No run with id ${id}`)
        return
      }
      const sub = match[2]
      res.setHeader('content-type', 'text/html; charset=utf-8')
      switch (sub) {
        case undefined:
          res.end(renderDetail(run))
          return
        case '/matched':
          res.end(renderMatched(run))
          return
        case '/graph':
          res.end(renderGraph(run))
          return
        case '/waterfall':
          res.end(renderWaterfall(run))
          return
        case '/side-by-side':
          res.end(await renderSideBySide(run, cssDir, reportDir))
          return
        case '/overlay':
          res.end(await renderOverlay(run))
          return
        default:
          notFound(res, `Unknown view ${sub}`)
      }
    })().catch((err) => {
      res.statusCode = 500
      res.setHeader('content-type', 'text/plain; charset=utf-8')
      res.end(`Internal error: ${err instanceof Error ? err.message : String(err)}`)
    })
  })
}

/** Starts the dev server bound to `localhost` by default (1005 §11). Resolves once listening. */
export async function serve(options: ServeOptions): Promise<{ server: Server; url: string }> {
  const host = options.host ?? '127.0.0.1'
  const port = options.port ?? 4600
  const server = createVisualizerServer(options)
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(port, host, () => resolveListen())
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address !== null ? address.port : port
  return { server, url: `http://${host}:${actualPort}` }
}
