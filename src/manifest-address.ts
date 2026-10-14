/**
 * Leaf's manifest, `31990:<manifest key>:estiva-leaf` — the one event that says
 * Leaf owns documents (`kind:30842`). `scripts/publish-manifest.ts` refuses any
 * key but this one's, so a republish replaces it rather than competing with it.
 * Moving to a new key is done by hand, in one PR: this line and the key together.
 */
export const MANIFEST_ADDRESS = '31990:9b0ff001e909e0c6eb9165b81118b0c580db2584c87e1c794a2ec9339f7541ec:estiva-leaf'
