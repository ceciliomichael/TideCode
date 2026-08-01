import type { CSSProperties } from 'react'
import { TIDECODE_WORDMARK_ASSET_URL } from '../../lib/brandAssets'

interface BrandWordmarkProps {
  className?: string
}

const WORDMARK_MASK_STYLE: CSSProperties = {
  maskImage: `url("${TIDECODE_WORDMARK_ASSET_URL}")`,
  maskPosition: 'center',
  maskRepeat: 'no-repeat',
  maskSize: 'contain',
  WebkitMaskImage: `url("${TIDECODE_WORDMARK_ASSET_URL}")`,
  WebkitMaskPosition: 'center',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskSize: 'contain',
}

export function BrandWordmark({ className = '' }: BrandWordmarkProps) {
  return (
    <span
      aria-label="TideCode"
      className={`inline-block shrink-0 bg-current ${className}`}
      role="img"
      style={WORDMARK_MASK_STYLE}
    />
  )
}
