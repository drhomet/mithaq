import { Slider as Primitive } from '@base-ui/react/slider'
import { cn } from '@/lib/utils'

export function Slider({ className, getAriaValueText, ...props }: Primitive.Root.Props<number> & Pick<Primitive.Thumb.Props, 'getAriaValueText'>) {
  return <Primitive.Root data-slot="slider" className={cn('flex w-full items-center', className)} {...props}>
    <Primitive.Control className="relative flex h-5 w-full items-center">
      <Primitive.Track className="bg-muted h-2 w-full rounded-full">
        <Primitive.Indicator data-slot="slider-range" className="bg-primary rounded-full" />
      </Primitive.Track>
      <Primitive.Thumb data-slot="slider-thumb" getAriaValueText={getAriaValueText} className="border-primary bg-background ring-ring/50 size-4 rounded-full border shadow-sm has-focus-visible:ring-3" />
    </Primitive.Control>
  </Primitive.Root>
}
