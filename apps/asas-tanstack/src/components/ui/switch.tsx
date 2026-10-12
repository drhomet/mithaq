import { Switch as Primitive } from '@base-ui/react/switch'
import { cn } from '@/lib/utils'

export function Switch({ className, ...props }: Primitive.Root.Props) {
  return <Primitive.Root data-slot="switch" className={cn('inline-flex h-6 w-11 items-center rounded-full bg-input p-0.5 data-checked:bg-primary disabled:opacity-50', className)} {...props}>
    <Primitive.Thumb className="size-5 rounded-full bg-background shadow-sm transition-transform data-checked:translate-x-5 rtl:data-checked:-translate-x-5" />
  </Primitive.Root>
}
