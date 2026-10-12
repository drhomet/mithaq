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

## Add or replace a control

Every screen draws a field's control from the components map the app hands
`ComponentsProvider`. The app mounts it around every route in
`src/router.tsx`, typed against the project's language:

```tsx
const components: ComponentsOf<Language> = defaultComponents
// ...
Wrap: ({ children }) => <ComponentsProvider components={components}>{children}</ComponentsProvider>,
```

To draw a shipped kind or control name with your own control, spread the
defaults and replace that one name. A kind your own rukn brings, which no
control the registry ships draws, names itself as its control, and the map
draws it under that name:

```ts
const color = kind<string>(isColor)({
  label: { en: 'Color', ar: 'لون' },
  message: { en: 'This is not a color.', ar: 'هذا ليس لونا.' },
  rules: ['required'],
  targets: { drizzle: drizzleKinds.text, zod: zodKinds.text, screen: { control: 'color', cell: 'text' } },
})
```

```tsx
const components: ComponentsOf<Language> = {
  ...defaultComponents,
  controls: { ...defaultComponents.controls, color: ColorControl, text: MyTextControl },
}
```

`ComponentsOf<Language>` requires one control per name the registry ships and
one per kind of the language that no shipped control draws, so leaving `color`
out, naming a key that is neither, or a control that does not take
`ControlProps` is a type error. A kind the language declares needs its entry
even when no kayan uses it, since the type reads the language and not the
kayan. A kind drawn by a `ui()` reference needs a map entry too, because an
operation's dialog, the upload dialog and a form drawn with no page draw it
through the map.

Each app's `src/server.ts` checks every screen it serves against the map as it
starts, through `checkComponents`, so a field whose kind has no control stops
the start with the kind and the field named. A route that throws while drawing
is replaced by `RouteError`, the router's `defaultErrorComponent`, and the shell
around it stays.

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
