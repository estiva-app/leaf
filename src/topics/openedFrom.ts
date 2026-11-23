import type { ForeignObject } from '@estiva-app/interop'
import { useEffect, useSyncExternalStore } from 'react'
import { fileKey } from '../folders/tree'
import { TOPICS_SHOWN } from './sidebarTopics'
import type { SidebarTopicsState } from './useSidebarTopics'

/**
 * Where the open file was clicked in the sidebar: under one of your initiatives, or not, as Peek's `rememberOpenedFrom`
 * (TOP-4). Its row is lit in that one place (Katerina, 23 November: "you have 2 selections in the sidebar"); opened any
 * other way, it is lit in its team, as before. It holds for that page only: the next page forgets it, a click in the
 * teams' tree does too, and a reload lights the team's.
 */
export interface OpenedFromInitiative {
  /** The initiative whose fold holds the clicked row, by address. */
  topic: string
  /** The file, by the key the tree selects it by (`fileKey`). */
  file: string
}

let last: OpenedFromInitiative | undefined
const listeners = new Set<() => void>()
const tell = () => listeners.forEach((listener) => listener())
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}

/** A row under an initiative was clicked: its page lights it there, and only there. */
export function rememberOpenedFromInitiative(topic: string, file: string): void {
  last = { topic, file }
  tell()
}

/** A row under an initiative was clicked: a plain click opens its page here, lit there; one for a new tab or window changes nothing here. */
export function rememberClickUnderInitiative(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }, topic: string, file: string): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
  rememberOpenedFromInitiative(topic, file)
}

/** Another page is open, or a row in the teams' tree was clicked: the click is spent, unless it was for this file. */
export function forgetOpenedFromInitiative(unless?: string): void {
  if (!last || last.file === unless) return
  last = undefined
  tell()
}

/**
 * The initiative the open file is lit under, where it was clicked, if the sidebar still draws it there: the teams' tree
 * then lights nothing. Absent, the file is lit in its team.
 */
export function useInitiativeLitUnder(
  topics: SidebarTopicsState,
  current: string | undefined,
  fileNow: (file: ForeignObject) => ForeignObject,
): string | undefined {
  const from = useSyncExternalStore(subscribe, () => last, () => undefined)
  // The click is spent once another page opens: the same file opened later some other way is lit in its team.
  useEffect(() => forgetOpenedFromInitiative(current), [current])
  if (!from || !current || from.file !== current || !Array.isArray(topics)) return undefined
  const drawn = topics.slice(0, TOPICS_SHOWN).some((topic) => topic.address === from.topic && topic.files.some((file) => fileKey(fileNow(file)) === current))
  return drawn ? from.topic : undefined
}
