/**
 * Distributed crawl — route-manifest sharding (M5 exit criterion 4;
 * `docs/implementation/002-Milestones.md` §8.6, `docs/performance/002-
 * Parallelization-Strategy.md`'s "parallel route batching" granularity
 * extended across process/machine boundaries rather than only within one).
 *
 * Model chosen: a **shard** (`--shard <i>/<n>`), not an in-process worker
 * pool. A shard is a slice of the *route manifest*, not a slice of browser
 * concurrency — each shard is an independent `run()` invocation (its own
 * process, its own `BrowserManager`) that only crawls the routes assigned to
 * it, and writes its artifacts under the *same* `--out-dir`/`--cache-dir` the
 * other shards use. This is what lets shards run on genuinely separate
 * machines (the milestone's "across more than one worker/machine" wording):
 * nothing about shard N depends on shard M's process being co-located, only
 * on both sharing a filesystem view of `--out-dir` (and, optionally,
 * `--cache-dir` — see `run.ts`'s cache-sharing note). A single machine gets
 * one-process-per-shard parallelism for free by launching `n` shard
 * invocations concurrently (e.g. `n` background CLI processes, or an `n`-way
 * CI matrix); this module does not additionally implement an in-process
 * `--workers` thread pool, since the shard model alone already satisfies the
 * exit criterion ("results aggregated identically to a single-process
 * crawl") and a second, redundant concurrency primitive inside one process
 * would duplicate the same partitioning logic for no criterion this
 * milestone asks for.
 *
 * Determinism (the criterion's teeth, `docs/testing/003-Golden-Files.md`):
 * route→shard assignment must be independent of (a) which worker/machine
 * runs it and (b) completion order. This module makes both true by
 * partitioning a *canonically sorted* (by `pattern`, lexicographic) route
 * list with a pure, order-independent function of the route's own identity
 * — never the order routes happen to appear in the manifest file, and never
 * anything timing-derived. Two processes independently computing shard 2/3
 * for the same manifest always agree on exactly which routes that is, before
 * either has extracted anything.
 */

import { ConfigError } from './config.js'

export interface ShardSpec {
  /** 1-based shard index (`i` in `i/n`). */
  readonly index: number
  /** Total shard count (`n` in `i/n`). */
  readonly total: number
}

const SHARD_PATTERN = /^(\d+)\/(\d+)$/

/** Parse and validate the `--shard <i>/<n>` flag value (1-based, `1 <= i <= n`). */
export function parseShardSpec(raw: string): ShardSpec {
  const match = SHARD_PATTERN.exec(raw.trim())
  if (match === null) {
    throw new ConfigError(`--shard must be of the form "<i>/<n>" (1-based, e.g. "1/3"), got: ${raw}`)
  }
  const index = Number(match[1])
  const total = Number(match[2])
  if (total < 1) {
    throw new ConfigError(`--shard total must be at least 1, got: ${raw}`)
  }
  if (index < 1 || index > total) {
    throw new ConfigError(`--shard index must satisfy 1 <= i <= n, got: ${raw}`)
  }
  return { index, total }
}

/**
 * Deterministically select the subset of `units` assigned to `shard`.
 *
 * Canonicalizes by sorting on `pattern` first (never the input array's own
 * order, which is manifest-authoring order and not a determinism-safe
 * partition key on its own — though in practice it is already stable, this
 * sort makes the guarantee explicit and independent of that upstream detail)
 * and then assigns by `sortedIndex % shard.total === shard.index - 1`
 * (round-robin over the canonical order). Round-robin rather than
 * contiguous-block partitioning is deliberate: it spreads routes with
 * expensive/cheap extraction cost evenly across shards regardless of where
 * in the manifest they cluster, and — being a pure function of
 * `(sortedIndex, shard.total)` — is exactly as reproducible as a contiguous
 * split while being less sensitive to a manifest that happens to group
 * expensive routes together.
 *
 * The union of `selectShardUnits(units, {index: k, total: n})` for
 * `k = 1..n` is exactly `units` (as a set, modulo the canonical sort), with
 * no overlap and no gap — this is what makes shard-output aggregation
 * (concatenating/union-ing each shard's artifacts) equivalent to a
 * single-process crawl of the full route set.
 */
export function selectShardUnits<T extends { readonly pattern: string }>(
  units: readonly T[],
  shard: ShardSpec,
): T[] {
  const sorted = [...units].sort((a, b) => (a.pattern < b.pattern ? -1 : a.pattern > b.pattern ? 1 : 0))
  return sorted.filter((_, sortedIndex) => sortedIndex % shard.total === shard.index - 1)
}

/**
 * Aggregation-time completeness check (criterion 4's "per-shard failure
 * semantics" nuance): a shard's own `run()` exit code already fails-at-end
 * for extraction errors *within* the routes it attempted (REQ-453, unchanged
 * by sharding). That does not, by itself, catch the case where an entire
 * shard invocation never ran at all (crashed before `run()` returned, was
 * never scheduled by the CI matrix, a transient infra failure killed the
 * process) — the *other* shards' artifacts still look complete on disk, and
 * a merge step that only checked "did every shard I heard from exit 0" would
 * silently publish a partial route set as if it were the full crawl.
 *
 * Call this once after collecting every shard's outcome, comparing the full,
 * unsharded manifest's route patterns against the union of patterns actually
 * produced (e.g. derived from the artifact/report files each shard wrote).
 * A nonempty return means the aggregate is incomplete — the caller must
 * treat this as a failed distributed crawl, not merge and publish anyway.
 */
export function missingShardRoutes(
  manifestPatterns: readonly string[],
  producedPatterns: readonly string[],
): string[] {
  const produced = new Set(producedPatterns)
  return manifestPatterns.filter((pattern) => !produced.has(pattern))
}
