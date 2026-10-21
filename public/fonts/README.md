# Fonts

All fonts are self-hosted variable WOFF2 files. No third-party font requests are made at runtime.

| Family | Used by | Files | Licence | Source |
| --- | --- | --- | --- | --- |
| Inter (100–900, optical size) | the run site and the installed app (Lobby, setup, sign-in, workspace) | `inter/inter-latin-opsz-normal.woff2`, Latin | SIL Open Font License 1.1, `inter/LICENSE.txt` | [Fontsource Inter Variable 5.2.8](https://www.npmjs.com/package/@fontsource-variable/inter/v/5.2.8), from [the Inter project](https://github.com/rsms/inter) |
| JetBrains Mono (100–800) | the run site's terminal and code | `jetbrains-mono/jetbrains-mono-latin-wght-normal.woff2`, Latin | SIL Open Font License 1.1, `jetbrains-mono/LICENSE.txt` | [Fontsource JetBrains Mono Variable 5.2.8](https://www.npmjs.com/package/@fontsource-variable/jetbrains-mono/v/5.2.8), from [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) |

`/rer-theme.css` declares both faces and the metric-matched `Inter Fallback`, so the installer serves them too, and names the stacks Base reads (`--rer-font-body`, `--rer-font-heading`). `/fonts/fonts.css` sets the page font and carries Plinth's own tokens and Base's sign-in pages in Plinth's look, which Base's theme grammar keeps out of `/rer-theme.css`; Base links it before the theme, and the run site imports both (`/site/theme.css`).

The e-signature drawn in the change-order section is an SVG path traced from Dancing Script 600 (SIL Open Font License 1.1, [Fontsource 5.2.8](https://www.npmjs.com/package/@fontsource/dancing-script/v/5.2.8)); no Dancing Script file is shipped.
