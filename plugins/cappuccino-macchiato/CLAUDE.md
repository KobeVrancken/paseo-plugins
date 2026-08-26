# Working on this plugin

Run `paseo plugin reload cappuccino-macchiato` after every change.
The reload is the only compile check of the bundle the daemon builds from `index.ts`.
Do this yourself; never leave it to the user.

The plugin is nothing but data: one `addTheme` call, no surface and no `plugin.handle`, so there is no server bundle and nothing to test beyond `pnpm typecheck`.
`PluginThemeColors` is the eight tokens Paseo expands into its own set — contributing more colours is not possible from here, so a mismatch with the app is fixed by choosing a different palette colour for one of the eight.
