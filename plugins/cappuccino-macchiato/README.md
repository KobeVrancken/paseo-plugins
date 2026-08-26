# Cappuccino Macchiato

Adds [Catppuccin Macchiato](https://catppuccin.com/palette/) to Settings -> Appearance.
Paseo already ships Catppuccin as a syntax-highlight theme; this contributes it as an app theme.

## Screenshots

_Just try it out, honestly. It's easy to switch back if you don't like it._

## Installation

```sh
paseo plugin install /absolute/path/to/paseo-plugins/plugins/cappuccino-macchiato
```

Then pick **Cappuccino Macchiato** in **Settings → Appearance**.

## Settings

The plugin has no settings of its own. Change your theme in Paseo itself under **Settings -> Appearance**.

## Development

```sh
paseo plugin reload cappuccino-macchiato  # after every edit; there is no hot reload
paseo plugin logs cappuccino-macchiato
```

A theme is data, so the whole plugin is one `addTheme` call in `index.ts` — no surface, no client bundle, no RPC.
