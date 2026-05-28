import { Icon } from '@iconify/react'

// Тонкая обёртка над пиксельным паком pixelarticons.
export function Px({ name, className }: { name: string; className?: string }) {
  return <Icon icon={`pixelarticons:${name}`} className={className} />
}
