import { gateConfig } from '@estiva-app/ui/gates'
import reactHooks from 'eslint-plugin-react-hooks'

/**
 * The UI Guardrails' rules on their own — `npm run lint:rules`, CI's job `gate`
 * (GitHub requires it on main: never rename it), and what the editor hook in
 * `.claude/settings.json` lints a proposed write with. The package's gate,
 * imported. React's hooks plugin is named so its directives do not break it;
 * TypeScript's the package names itself.
 *
 * A place that keeps something the gate refuses says why, on the line above:
 * `// @estiva-escape(<rule>): <reason>`, naming the rule it keeps off. Never
 * `eslint-disable`: the count refuses it.
 */
export default gateConfig({ quiet: { 'react-hooks': reactHooks } })
