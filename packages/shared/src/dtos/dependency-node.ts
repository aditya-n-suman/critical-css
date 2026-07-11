/**
 * DependencyNode DTO, per docs/architecture/004-Terminology.md: nodes are CSS
 * constructs, edges are "requires" relationships (a rule referencing
 * `var(--x)` has an edge to the custom-property node).
 */

export type DependencyNodeType =
  | 'variable'
  | 'keyframes'
  | 'font-face'
  | 'property'
  | 'counter-style'
  | 'layer'
  | 'media'
  | 'container'
  | 'supports'
  | 'import'

export interface DependencyNode {
  /** Stable node identity within one dependency graph. */
  readonly id: string
  readonly type: DependencyNodeType
  /**
   * The construct's identifying value: variable name (`--x`), keyframes name,
   * font-family, layer name, media/container/supports condition text, …
   */
  readonly value: string
  /** Serialized rule text backing this node, when one exists. */
  readonly cssText: string | null
  /** Ids of nodes that depend on (require) this node. */
  readonly dependents: readonly string[]
  /** Ids of nodes this node itself requires (transitive dependencies). */
  readonly dependencies: readonly string[]
}
