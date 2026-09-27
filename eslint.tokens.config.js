import { tokenConfig } from '@estiva-app/ui/gates'
import reactHooks from 'eslint-plugin-react-hooks'

// The token contract on its own (`npm run lint:tokens`), the package's piece.
// React's hooks plugin is named so its directives do not break it; TypeScript's
// the package names itself.
export default tokenConfig({ quiet: { 'react-hooks': reactHooks } })
