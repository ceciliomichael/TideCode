
import { BrandWord } from './branding/BrandWord'

interface EmptyStateProps {
  folderName: string
}

export function EmptyState({ folderName }: EmptyStateProps) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center">
      <div className="mb-0 flex items-center justify-center">
        <BrandWord className="h-24 w-[264px] text-foreground/80 md:h-28 md:w-[308px]" />
      </div>
      <div className="space-y-2 text-center">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground md:text-3xl">
          Start a conversation in {folderName}
        </h2>
        <p className="text-base text-muted-foreground md:text-lg">Send a message to begin chatting</p>
      </div>
    </div>
  )
}
