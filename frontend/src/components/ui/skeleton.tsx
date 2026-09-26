import * as React from "react"

import { cn } from "@/utils"

/**
 * A placeholder block in the shape of content that is still loading.
 *
 * Decorative by construction: it carries no text, so the screen that uses it
 * owns the one announcement ("loading…") for the whole region.
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden
      className={cn("animate-pulse rounded-md bg-muted", className)}
      {...props}
    />
  )
}

export { Skeleton }
