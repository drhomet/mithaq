import { useContext, type ComponentProps } from 'react'
import { OTPInput, OTPInputContext } from 'input-otp'
import { cn } from '@/lib/utils'

export function InputOTP({ className, containerClassName, ...props }: ComponentProps<typeof OTPInput>) {
  return <OTPInput data-slot="input-otp" className={cn('disabled:cursor-not-allowed', className)} containerClassName={cn('flex items-center gap-2', containerClassName)} {...props} />
}

export function InputOTPGroup({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="input-otp-group" className={cn('flex items-center', className)} {...props} />
}

export function InputOTPSlot({ index, className, ...props }: ComponentProps<'div'> & { index: number }) {
  const { slots } = useContext(OTPInputContext)
  const slot = slots[index]
  return <div data-slot="input-otp-slot" data-active={slot?.isActive} className={cn('border-input relative flex size-9 items-center justify-center border text-sm', className)} {...props}>
    {slot?.char}
    {slot?.hasFakeCaret ? <span className="bg-foreground absolute h-4 w-px animate-pulse" /> : null}
  </div>
}
