# The admin registry

The controls, cells, forms, lists and shells a screen
draws with are a shadcn registry that ships with mithaq, served under
`@mithaq/<item>`. A project copies the files it uses with `shadcn add`, and
owns them from then on. Each copied file ends with a marker line naming the
commit it came from and a hash of its text.

How a project uses and edits its copies is in [Add a screen component](../../templates/asas/README.md#add-a-screen-component).

## `mithaq upgrade --check`

`mithaq upgrade --check` compares every copied registry file with the
installed registry, one line per file, and never writes; you merge a change by
hand. Where it lives: `packages/mithaq/src/asas/cli/upgrade.ts` `upgradeCheck`.
[The `mithaq` command](../mithaq/src/asas/cli/README.md#upgrade---check) describes it.

## Replace a control

Every screen draws a field's control from the components map the app hands
`ComponentsProvider`. The app mounts it around every route in
`src/router.tsx`, with the map the registry ships:

```tsx
Wrap: ({ children }) => <ComponentsProvider components={defaultComponents}>{children}</ComponentsProvider>,
```

To draw a shipped kind or control name with your own control, spread the
defaults and replace that one name:

```tsx
const components = { ...defaultComponents, controls: { ...defaultComponents.controls, text: MyTextControl } }
```

The map's keys are the control names the registry ships, so a name it does
not ship, or a control that does not take `ControlProps`, is a type error. A
new control name belongs in the screen's `components`, as a `ui()` reference.
A shipped kind the map leaves out is an error when a field of that kind is
drawn, and a kind of your own that no registry ships is drawn read-only by the
map's `uuid` control.

## Add a registry item

A registry item is shipped by mithaq for every project. The registry is a shadcn registry in `packages/mithaq-admin/`:

1. Write the file under `packages/mithaq-admin/registry/`, and list it as an item in `packages/mithaq-admin/registry.json` with its `target` and its `registryDependencies`. A shadcn primitive is named by its bare name, and a sibling item by `./node_modules/mithaq-admin/r/<item>.json`.
2. Put every comment below the imports. `shadcn add` drops a file's leading comment block.
3. Add the item's name to the list in `packages/mithaq-admin/test/render.test.ts` `the app holds the current source of every registry item it copied`.
4. Rebuild `r/` with `bun run build` in `packages/mithaq-admin` (a fresh `bun install` runs it too). `r/` is build output and is not committed. The build appends the marker line to every file: `// mithaq-admin <commit> <hash>`.
5. Copy it into the app that uses it, or into `templates/asas` for a server file, from that folder: `shadcn add ./node_modules/mithaq-admin/r/<item>.json --overwrite --yes`.
6. Run `bunx mithaq upgrade --check` in that folder. It exits 1 when a copy differs from the registry; [The `mithaq` command](../mithaq/src/asas/cli/README.md#upgrade---check) lists what each line means.

### A registry step

A step every project may want, and may want to change, ships as a registry file rather than as core code. `expectedUpdatedAt` is one: it lives in `packages/mithaq-admin/registry/steps/expected-updated-at.ts` in the mithaq repository, the registry item `mithaq-expected-updated-at` copies it to `src/steps/expected-updated-at.ts`, and a project edits its copy in place. Write a new one the same way, and follow [Add a registry item](#add-a-registry-item). Put the step's tests beside it so a replacement can run them.
