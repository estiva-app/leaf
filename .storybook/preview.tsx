import type { Preview } from '@storybook/react-vite'
import { sb } from 'storybook/test'
import '../src/index.css'

// The modules a story hands the relay's answers through (`mocked(…)` in its `beforeEach`, Pages/Ship file in Leaf):
// spied, so a story that hands nothing keeps the real one. Without them those stories threw before drawing.
sb.mock(import('../src/relay/bridge.ts'), { spy: true })
sb.mock(import('../src/comments/useThreads.ts'), { spy: true })
// The tab's live connection and a file's read again, for a save someone else makes while the page is open (Pages/Ship
// file in Leaf / Newer Save, drawn by FilePage itself). A story that sets them puts them back when it is left.
sb.mock(import('../src/relay/client.ts'), { spy: true })
sb.mock(import('../src/document/save.ts'), { spy: true })

// The app's one theme, selected the way the app selects it: on <html>.
document.documentElement.dataset.theme = "leaf"

const preview: Preview = {
  // Every story file gets a Docs page, as in Peek and Ship: the catalogue links each
  // part to it, and `npm run registry:check` in CI's job `gate` fails a link that
  // leads nowhere.
  tags: ['autodocs'],
  parameters: { layout: 'centered' },
}

export default preview
