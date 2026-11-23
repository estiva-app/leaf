import { beforeEach, describe, expect, it, vi } from 'vitest'

/* Katerina, 23 November: the sidebar folds the teams you are not in under "Other teams", as Peek's Teams column. */

const queryAll = vi.fn()
vi.mock('../relay/bridge', () => ({ queryAll: (filters: unknown[]) => queryAll(filters), viewerPubkey: () => ME }))

const ME = 'c'.repeat(64)
const OTHER = 'd'.repeat(64)
const roster = (team: string, people: string[]) => ({ id: team.padEnd(64, '0'), kind: 39002, pubkey: 'e'.repeat(64), created_at: 100, content: '', sig: '', tags: [['d', team], ...people.map((p) => ['p', p])] })

const { readTeamsYouAreIn } = await import('./teamsYouAreIn')

beforeEach(() => queryAll.mockReset())

describe('readTeamsYouAreIn', () => {
  it('names the teams whose roster lists the viewer, in one read of every team', async () => {
    queryAll.mockResolvedValueOnce([roster('hq', [ME, OTHER]), roster('peek', [OTHER])])
    expect([...(await readTeamsYouAreIn(['hq', 'peek', 'leaf'], ME))]).toEqual(['hq'])
    expect(queryAll).toHaveBeenCalledTimes(1)
  })

  it('rejects when the read fails: a failed read is not "in no team"', async () => {
    queryAll.mockRejectedValueOnce(new Error('relay down'))
    await expect(readTeamsYouAreIn(['hq'], ME)).rejects.toThrow('relay down')
  })
})
