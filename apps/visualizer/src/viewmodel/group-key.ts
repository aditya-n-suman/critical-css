/** Shared grouping key for "group selectors by source stylesheet" views. */
export function groupKeyOf(href: string | null): string {
  return href ?? ' inline'
}
