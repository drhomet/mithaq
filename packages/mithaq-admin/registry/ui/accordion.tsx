import { Accordion as Primitive } from '@base-ui/react/accordion'
import { cn } from '@/lib/utils'

export const Accordion = Primitive.Root
export const AccordionItem = Primitive.Item
export const AccordionHeader = Primitive.Header
export const AccordionPanel = Primitive.Panel
export function AccordionTrigger({ className, ...props }: Primitive.Trigger.Props) {
  return <Primitive.Trigger className={cn('flex w-full cursor-pointer items-center justify-between px-4 py-3 text-start', className)} {...props} />
}
