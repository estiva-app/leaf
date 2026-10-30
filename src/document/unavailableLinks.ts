import { unavailableMemory } from '@estiva-app/ui'

/**
 * Links this device last found not available — deleted, or not this reader's
 * to see — so the next open draws "not available" from the first paint, not a
 * placeholder that then shrinks to it (Peek's and Ship's OPT-10). The kit's
 * memory, under Leaf's own key; only an answer of nothing is remembered, never
 * a read that failed. Cleared at sign-out with the rest of the device's copy.
 */
export const unavailableLinks = unavailableMemory('leaf.unavailable-links', 300)
