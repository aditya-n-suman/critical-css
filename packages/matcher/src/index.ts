/**
 * @critical-css/matcher — public API barrel (AT-04, M1 slice).
 *
 * Matching is exclusively `element.matches()` in-page (ADR-0002). No CSS
 * selector parsing library may ever enter this dependency tree.
 */

export { SelectorMatcher } from './matcher.js'
export type { MatchedRuleSet, CssomRuleMatch } from './matcher.js'
export { splitSelectorList, extractBaseSelector, containsDynamicPseudoClass } from './selector-normalize.js'
export type { BaseSelectorExtraction } from './selector-normalize.js'
