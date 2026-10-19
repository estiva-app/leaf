import type { Preview } from '@storybook/react-vite'
import { sb } from 'storybook/test'
import '../src/index.css'

// A story has no relay: the comments column's threads, and the names and profiles it asks the relay for, are handed in
// by the story that draws it (the Ship file prototype). Spied, so the real code runs wherever a story hands nothing in.
sb.mock(import('../src/comments/useThreads.ts'), { spy: true })
sb.mock(import('../src/relay/bridge.ts'), { spy: true })

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
