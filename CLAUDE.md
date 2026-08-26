# Working in this workspace

A pnpm workspace of paseo plugins, one per directory under `plugins/`.
Each package is a plugin directory in its own right: paseo is installed against `plugins/<name>`, and `index.ts` and `paseo-plugin.json` sit at that package's root because the loader stats exactly those names.

Dependencies belong to the package that uses them, not the root, because the daemon's esbuild resolves from the plugin directory.
`pnpm typecheck` and `pnpm test` at the root fan out to every package; the package-level scripts are the ones to run while working on a single plugin.

Each package carries its own CLAUDE.md with the constraints that apply to it.
