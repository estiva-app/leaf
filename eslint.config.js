import js from '@eslint/js'
import { gateLint, TOKEN_LINT_IGNORES, tokenLint, tokenValues } from '@estiva-app/ui/gates'
import reactHooks from 'eslint-plugin-react-hooks'
import { defineConfig, globalIgnores } from 'eslint/config'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Everything, in one lint (`npm run lint`, a CI step): TypeScript's and React's
 * recommended rules, the token contract and the UI Guardrails' rules. A new app
 * has no backlog, so all of it is a gate from the first commit.
 *
 * The token contract and the gate are the package's (`@estiva-app/ui/gates`),
 * imported, never copied: a rule written later arrives with a version bump.
 */
export default defineConfig([
  globalIgnores(TOKEN_LINT_IGNORES),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
  },
  tokenLint(),
  tokenValues(),
  gateLint(),
])
