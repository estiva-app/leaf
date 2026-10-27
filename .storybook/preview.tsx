import type { Preview } from '@storybook/react-vite'
import { sb } from 'storybook/test'
import '../src/index.css'

// The relay's reads a story hands in with `mocked(...)`: registered here, or `mocked` gets the real function and
// the story fails before it draws (the Ship-file stories did, until LED-1). Spies, so every other story reads as the app does.
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
