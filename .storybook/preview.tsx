import type { Preview } from '@storybook/react-vite'
import '../src/index.css'

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
