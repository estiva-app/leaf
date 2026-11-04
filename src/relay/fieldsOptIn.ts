import { fieldsOptedIn } from '@estiva-app/protocol'

const OPT_IN_KEY = 'leaf.projectFields'

function tabStorage(): Storage | undefined {
  try {
    return window.sessionStorage
  } catch {
    return undefined
  }
}

/**
 * This tab's opt-in to reading projects by their fields (ALO-6): `?fields=on|off` in the address Leaf opened with,
 * kept for the tab only (protocol's `fieldsOptedIn`). Called once before sign-in can move the address, then read
 * from the tab's storage.
 */
export function fieldsOptIn(search = ''): boolean {
  return fieldsOptedIn(search, tabStorage(), OPT_IN_KEY)
}
