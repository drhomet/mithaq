# Shared rich text

`@drhomet/mithaq-rich-text` holds mithaq's shared Lexical node classes, JSON
versions and readers, value guards, feature data, policy and support registry.
Apps without a mithaq server, including Rounds, install only this package and
the Lexical peers they use, pinned at **0.52.0**. It has no server, React,
drizzle or zod dependency. It releases at the same version as mithaq and
mithaq-admin; pin all packages used by an app to that exact version and resolve
one copy of this package and Lexical.

```sh
bun add --exact @drhomet/mithaq-rich-text lexical@0.52.0 @lexical/extension@0.52.0 @lexical/link@0.52.0 @lexical/list@0.52.0 @lexical/rich-text@0.52.0 @lexical/hashtag@0.52.0 @lexical/mark@0.52.0 @lexical/table@0.52.0 @lexical/code-core@0.52.0
```

The root entry exports the shared readers, nodes, feature-node selection and
registry. `/client` keeps optional table, code and mention class imports out
of an editor's initial bundle. `/value`, `/policy`, `/feature-data` and
`/registry` need no Lexical runtime; `/mention` exports `MentionNode`, and
`/nodes` exports `richTextFeatureNodes`. The CLI is a separate Node bin,
`mithaq-check-rich-text`, and never enters the library bundle. Lexical peers
are optional so a registry-only consumer installs none; an entry using node
classes needs the corresponding peers above.

The `richText` rukn, its zod and drizzle targets, comments service and write
version gate remain in core. The React editor and viewer remain in
mithaq-admin. Existing `mithaq/rich-text`, `/client`, `/mention` and `/registry`
imports re-export the same classes and values, so existing apps need no import
changes. Stored JSON is unchanged.

See the [rich text guide](../mithaq/README.md#rich-text-features) and
[support checks](../mithaq/README.md#rich-text-support-checks).
