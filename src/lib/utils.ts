/**
 * Lightweight className combiner. Joins truthy class strings with a single space.
 * Keeps the component code readable without pulling in a dependency (the project
 * does not bundle clsx / tailwind-merge).
 */
export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
