/**
 * A refusal a person is meant to read: the CLI prints its message alone, and
 * rethrows every other error with its stack.
 */
export class Refusal extends Error {}
