import { RadioGroup as Group } from '@base-ui/react/radio-group'
import { Radio } from '@base-ui/react/radio'
import { cn } from '@/lib/utils'

export const RadioGroup = Group
export function RadioGroupItem({ className, ...props }: Radio.Root.Props) {
  return <Radio.Root data-slot="radio-group-item" className={cn('border-input data-checked:border-primary inline-flex size-4 items-center justify-center rounded-full border', className)} {...props}>
    <Radio.Indicator className="bg-primary size-2 rounded-full" />
  </Radio.Root>
}
