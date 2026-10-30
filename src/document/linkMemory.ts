import { cardShapeMemory, unavailableMemory } from '@estiva-app/ui'

/*
  What this device remembers about the links it drew, so the next open draws
  them from the first paint as they were, not a placeholder that then changes
  size (Peek's and Ship's OPT-10, peek#533): the kit's two memories, under
  Leaf's own keys, as Peek and Ship keep theirs. Cleared at sign-out with the
  rest of the device's copy (`forgetLinkMemory`).
*/

/**
 * Links this device last found not available — deleted, or not this reader's
 * to see. Only an answer of nothing is remembered, never a read that failed.
 */
export const unavailableLinks = unavailableMemory('leaf.unavailable-links', 300)

/** The shape each card last drew at, for its placeholder the next time (`loadingShapeOf`). */
export const cardShapes = cardShapeMemory('leaf.card-shapes')

/** Sign-out: nothing this device remembers about another person's links stays. */
export function forgetLinkMemory(): void {
  unavailableLinks.clear()
  cardShapes.clear()
}
