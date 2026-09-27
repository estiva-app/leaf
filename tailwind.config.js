import estiva, { estivaContent } from '@estiva-app/ui/tailwind-preset'

/**
 * The package's preset, and nothing of the app's own: a token is added to the
 * package, in every theme, never here.
 *
 * `estivaContent` is the package's own files. Tailwind does not merge `content`
 * from a preset, so without it every class used only by a package part is
 * purged, and the app builds clean while rendering at the wrong size.
 *
 * @type {import('tailwindcss').Config}
 */
export default {
  presets: [estiva],
  content: [...estivaContent, './index.html', './src/**/*.{ts,tsx}', './.storybook/**/*.{ts,tsx}'],
}
