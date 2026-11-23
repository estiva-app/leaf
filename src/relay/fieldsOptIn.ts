import { DOCUMENT_TYPE, ISSUE_TYPE, TOPIC_TYPE, fieldsOptedIn, typeFieldsOptedIn } from '@estiva-app/protocol'

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

/**
 * This tab's opt-in to reading and writing issues by their fields (ISS-6): `?issueFields=on|off`, kept for the tab
 * only and apart from the projects' one (protocol's `typeFieldsOptedIn`), as Ship's and Peek's.
 */
export function issueFieldsOptIn(search = ''): boolean {
  return typeFieldsOptedIn(ISSUE_TYPE, search, tabStorage())
}

/** This tab's opt-in to writing pages in order (ALL-4): `?documentFields=on|off`, kept for the tab, as the issues' one. */
export function documentFieldsOptIn(search = ''): boolean {
  return typeFieldsOptedIn(DOCUMENT_TYPE, search, tabStorage())
}

/** This tab's opt-in to writing a topic's file list in order (ALL-4): `?topicFields=on|off`, kept for the tab. */
export function topicFieldsOptIn(search = ''): boolean {
  return typeFieldsOptedIn(TOPIC_TYPE, search, tabStorage())
}
