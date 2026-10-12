import { ToggleGroup as Group } from '@base-ui/react/toggle-group'
import { Toggle } from '@base-ui/react/toggle'
import { cn } from '@/lib/utils'

export const ToggleGroup = Group
export function ToggleGroupItem({ className, ...props }: Toggle.Props) {
  return <Toggle data-slot="toggle-group-item" className={cn('border-input data-pressed:bg-accent rounded-md border px-3 py-2 text-sm disabled:opacity-50', className)} {...props} />
}
