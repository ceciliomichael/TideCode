import type { CSSProperties } from 'react'
import { TIDECODE_WORD_ASSET_URL } from '../../lib/brandAssets'

interface BrandWordProps {
  className?: string
}

const WORD_MASK_STYLE: CSSProperties = {
  maskImage: `url("${TIDECODE_WORD_ASSET_URL}")`,
  maskPosition: 'center',
  maskRepeat: 'no-repeat',
  maskSize: 'contain',
  WebkitMaskImage: `url("${TIDECODE_WORD_ASSET_URL}")`,
  WebkitMaskPosition: 'center',
  WebkitMaskRepeat: 'no-repeat',
  WebkitMaskSize: 'contain',
}

export function BrandWord({ className = '' }: BrandWordProps) {
  return <span aria-label="TideCode" className={`inline-block shrink-0 bg-current ${className}`} role="img" style={WORD_MASK_STYLE} />
}
