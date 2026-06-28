import { cn } from "@/lib/utils"

type PreviewProps = {
  isActive?: boolean
  className?: string
}

function PreviewFrame({
  isActive,
  className,
  children,
}: PreviewProps & { children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-md border p-2 text-[10px] leading-tight",
        isActive ? "border-primary bg-primary/10" : "border-border bg-muted/40",
        className,
      )}
    >
      {children}
    </div>
  )
}

export function LayoutPreviewClassic({ isActive, className }: PreviewProps) {
  return (
    <PreviewFrame isActive={isActive} className={className}>
      <div className="flex gap-1.5 min-h-[72px]">
        <div className="w-5 shrink-0 rounded-sm bg-foreground/10 flex flex-col gap-0.5 p-0.5">
          <span className="h-1.5 w-full rounded-sm bg-foreground/25" />
          <span className="h-1.5 w-full rounded-sm bg-foreground/15" />
          <span className="h-1.5 w-full rounded-sm bg-foreground/20" />
        </div>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="rounded-sm bg-foreground/10 px-1 py-0.5 font-medium">Claude</div>
          <div className="h-1 rounded-full bg-foreground/10 overflow-hidden">
            <div className="h-full w-[34%] bg-foreground/50 rounded-full" />
          </div>
          <div className="flex justify-between text-muted-foreground tabular-nums">
            <span>66% left</span>
            <span>Today $24.14</span>
          </div>
        </div>
      </div>
    </PreviewFrame>
  )
}

export function LayoutPreviewModern({ isActive, className }: PreviewProps) {
  return (
    <PreviewFrame isActive={isActive} className={className}>
      <div className="space-y-1.5">
        <div className="flex items-center gap-1 rounded-sm border border-foreground/10 bg-background/60 px-1 py-0.5">
          <span className="font-semibold">Claude</span>
          <span className="ml-auto tabular-nums text-muted-foreground">66%</span>
        </div>
        <div className="rounded-sm border border-foreground/10 bg-background/60 p-1 space-y-0.5">
          <div className="flex justify-between font-medium">
            <span>Session</span>
            <span className="tabular-nums">66% left</span>
          </div>
          <div className="h-1 rounded-full bg-foreground/10">
            <div className="h-full w-[66%] rounded-full bg-foreground/45" />
          </div>
          <div className="flex gap-2 text-muted-foreground tabular-nums">
            <span>Today $12</span>
            <span>Yesterday $8</span>
          </div>
        </div>
        <div className="flex gap-0.5 justify-end opacity-70">
          <span className="rounded-sm bg-foreground/15 px-1 tabular-nums">66%</span>
          <span className="rounded-sm bg-foreground/15 px-1 tabular-nums">42%</span>
        </div>
      </div>
    </PreviewFrame>
  )
}
