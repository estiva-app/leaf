import { appChecks } from '@estiva-app/ui/gates'

/**
 * What gates:status checks in leaf: the gate checks every app runs, from the
 * package (`appChecks`), and nothing of its own yet. A check about this app's
 * own code goes beside them.
 */
export default function define(h) {
  return { repo: 'leaf', tickets: appChecks(h, { page: 'src/pages/HomePage.tsx' }) }
}
