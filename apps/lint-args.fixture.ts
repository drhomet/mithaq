export function threePositional(a: string, b: string, c: string) {
  return a + b + c
}

export const arrowOfThree = (a: number, b: number, c: number) => a + b + c

export type CallbackOfThree = (a: string, b: string, c: string) => void

export interface AdapterWithThree {
  insert(tx: unknown, kayan: string, data: unknown): void
  find: (args: unknown) => void
}

export function oneObject({ a, b, c }: { a: string; b: string; c: string }) {
  return a + b + c
}

export const twoPositional = (left: unknown, right: unknown) => left === right

function internalOfThree(a: string, b: string, c: string) {
  return a + b + c
}

export const usesInternal = () => internalOfThree('a', 'b', 'c')

export class ClassOfThree {
  constructor(a: string, b: string, c: string) {
    void [a, b, c]
  }
  method(a: string, b: string, c: string) {
    return a + b + c
  }
}

export const takesCallbackOfThree = ({ read }: { read: (a: string, b: string, c: string) => void }) => read('a', 'b', 'c')

function listedOfThree(a: string, b: string, c: string) {
  return a + b + c
}

export { listedOfThree }

export default class {
  constructor(a: string, b: string, c: string) {
    void [a, b, c]
  }
}
