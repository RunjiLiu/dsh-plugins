# dsh-plugins

One repository, one package per DSH bundle. Each package under `packages/` is a
self-contained bundle (`dsh.bundle.patch`, optional `dsh.client`) and installs on
its own; the repository adds no runtime layer of its own.

## Packages

| Package | Directory | What it does |
| --- | --- | --- |
| `@local/dsh-composer-rich-input` | `packages/composer-lists` | List continuation and hanging indent, Tab/Shift+Tab indent, Ctrl+E line end in the Web composer. |

## Install one package from this repository

A bundle in a subdirectory installs with the package path appended to the Git
spec:

```
git+https://github.com/<owner>/dsh-plugins.git#<commit>&path:/packages/composer-lists
```

Use the same form in **Plugins → Add plugin**, or point `plugin_manager`'s
`install_bundle` at it. Keep the commit pinned; `#main` resolves the branch but
pnpm may serve a cached copy.

## Install from a local checkout

```bash
git clone https://github.com/<owner>/dsh-plugins.git ~/dsh-plugins
```

Then install the package **directory** (a `link:` dependency, so later
`git pull` updates it without reinstalling):

```
/root/dsh-plugins/packages/composer-lists
```

## Adding another plugin

1. `packages/<name>/` with its own `package.json` declaring
   `dsh.bundle.patch` (and `dsh.client` for a browser half).
2. A unique package name, `locale/*.json` metadata and an `icon.svg`.
3. Commit, push, install with the `&path:/packages/<name>` spec.
