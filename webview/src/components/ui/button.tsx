import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '../../lib/utils'

const buttonVariants = cva(
  [
    'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold',
    'border-2 border-foreground rounded-none',
    'shadow-[2px_2px_0_0_var(--foreground)]',
    'transition-[transform,box-shadow] duration-75 [transition-timing-function:steps(2,end)]',
    'hover:-translate-x-px hover:-translate-y-px hover:shadow-[3px_3px_0_0_var(--foreground)]',
    'active:translate-x-[2px] active:translate-y-[2px] active:shadow-none',
    'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
    'disabled:pointer-events-none disabled:opacity-50 cursor-pointer',
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  ].join(' '),
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary',
        destructive: 'bg-destructive text-white border-foreground hover:bg-destructive',
        outline: 'bg-background text-foreground hover:bg-accent',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary',
        ghost:
          'border-transparent shadow-none hover:bg-accent hover:text-accent-foreground hover:shadow-none active:translate-x-0 active:translate-y-0',
        brand:
          'bg-pixel-magenta text-white border-foreground shadow-[3px_3px_0_0_var(--foreground)] hover:bg-pixel-magenta hover:shadow-[4px_4px_0_0_var(--foreground)]',
      },
      size: {
        default: 'h-10 px-4 py-2',
        xs: "h-7 gap-1 px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-9 gap-1.5 px-3 text-xs',
        lg: 'h-12 px-6 text-base',
        icon: 'size-10',
        'icon-sm': 'size-9',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant,
  size,
  ...props
}: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants>) {
  return <button className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
