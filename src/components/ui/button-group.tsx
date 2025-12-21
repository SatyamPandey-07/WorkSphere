"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

const ButtonGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("inline-flex items-center gap-2", className)}
    {...props}
  />
));
ButtonGroup.displayName = "ButtonGroup";

const ButtonGroupText = React.forwardRef<
  HTMLSpanElement,
  React.HTMLAttributes<HTMLSpanElement>
>(({ className, ...props }, ref) => (
  <span
    ref={ref}
    className={cn("text-sm text-zinc-600 dark:text-zinc-400", className)}
    {...props}
  />
));
ButtonGroupText.displayName = "ButtonGroupText";

export { ButtonGroup, ButtonGroupText };
