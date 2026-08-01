import type { CSSProperties } from 'react'
import { TIDECODE_MARK_ASSET_URL } from '../../lib/brandAssets'

interface BrandMarkProps {
  className?: string
  label?: string
}

const MARK_MASK_STYLE: CSSProperties = {
  maskImage: `url("${TIDECODE_MARK_ASSET_URL}")`,
  maskPosition: 'center',
  maskRepeat: 'no-repeat',
  maskSize: 'contain',
  WebkitMaskImage: `url("${TIDECODE_MARK_ASSET_URL}")`,
  WebkitMaskPosition: 'center',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskSize: 'contain',
}

export function BrandMark({ className = '', label }: BrandMarkProps) {
  return (
    <span
      aria-hidden={label ? undefined : true}
      aria-label={label}
      className={`inline-block shrink-0 bg-current ${className}`}
      role={label ? 'img' : undefined}
      style={MARK_MASK_STYLE}
    />
  )
}
