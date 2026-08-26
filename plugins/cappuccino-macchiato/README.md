# Cappuccino Macchiato

A dark app theme for Paseo, in the [Catppuccin Macchiato](https://catppuccin.com/palette/) palette.
Paseo already ships Catppuccin as a syntax-highlight theme; this contributes it as the theme of the app around the code.

## Screenshots

_None yet._

## Installation

```sh
paseo plugin install /absolute/path/to/paseo-plugins/plugins/cappuccino-macchiato
```

Then pick **Cappuccino Macchiato** in **Settings → Appearance**.

## Settings

The theme has none. The eight tokens it contributes are:

| Token             | Palette colour |           |
| ----------------- | -------------- | --------- |
| `background`      | `base`         | `#24273a` |
| `foreground`      | `text`         | `#cad3f5` |
| `raised`          | `surface0`     | `#363a4f` |
| `control`         | `surface1`     | `#494d64` |
| `border`          | `surface1`     | `#494d64` |
| `accent`          | `mauve`        | `#c6a0f6` |
| `mutedForeground` | `subtext0`     | `#a5adcb` |
| `ring`            | `overlay0`     | `#6e738d` |

Paseo expands those eight into its full token set, so `accent` drives buttons and selection while `border`, shared with `control`, stays the border and the tint of raised surfaces.

## Development

```sh
paseo plugin reload cappuccino-macchiato  # after every edit; there is no hot reload
paseo plugin logs cappuccino-macchiato
```

A theme is data, so the whole plugin is one `addTheme` call in `index.ts` — no surface, no client bundle, no RPC.
