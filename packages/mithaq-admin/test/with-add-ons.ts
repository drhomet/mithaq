// The map the template's apps hand their screens: the defaults with the rich text and files add-ons spread in, as each app's router spreads them.
type Spread = { controls: object; cells: object }
export const withAddOns = <Components extends Spread>(components: Components, ...addOns: readonly Spread[]): Components => ({
  ...components,
  controls: Object.assign({}, components.controls, ...addOns.map((one) => one.controls)),
  cells: Object.assign({}, components.cells, ...addOns.map((one) => one.cells)),
})
