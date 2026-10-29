import { isStore, serviceTargetOf, type Language } from '../mithaq/language-core.ts'
import type { Kayan } from '../mithaq/types.ts'

/** Checked before resolution so a refused build never initializes a target or auth factory. */
export const refusePlacement = ({ language, kayan, http, runtime }: { language: Language; kayan: readonly Kayan[]; http: readonly unknown[]; runtime: 'server' | 'device' }) => {
  for (const one of kayan) {
    const name = one.targets?.service?.store ?? serviceTargetOf(language)?.store
    const store = name && language.targets[name]
    const device = store && isStore(store) && store.placement === 'device'
    if (one.placement === 'device' && (runtime === 'server' || !device)) throw new Error(`Kayan "${one.name}" is device-only and cannot be built into a server asas. Use a device store.`)
    if (!device) continue
    if (Object.values(one.fields).some((field) => field.targets?.tenant !== undefined)) throw new Error(`Kayan "${one.name}" places a tenant field, which a device asas cannot hold.`)
    if (one.auth && 'provider' in one.auth && one.auth.provider === 'better-auth') throw new Error(`Kayan "${one.name}" needs Better Auth, which a device asas cannot run.`)
    if (http.length) throw new Error(`Kayan "${one.name}" uses a device store, which supports no HTTP target. Build with http: [].`)
  }
}
