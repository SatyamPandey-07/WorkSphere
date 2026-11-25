import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-zinc-900 text-zinc-50 hover:bg-zinc-900/80 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-50/80",
        secondary:
          "border-transparent bg-zinc-100 text-zinc-900 hover:bg-zinc-100/80 dark:bg-zinc-800 dark:text-zinc-50 dark:hover:bg-zinc-800/80",
        destructive:
          "border-transparent bg-red-500 text-zinc-50 hover:bg-red-500/80 dark:bg-red-900 dark:text-zinc-50 dark:hover:bg-red-900/80",
        outline:
          "text-zinc-950 dark:text-zinc-50 border-zinc-200 dark:border-zinc-800",
        "neon-cyberpunk":
          "border border-cyan-400 border-r-fuchsia-500 border-b-fuchsia-500 bg-zinc-950/90 text-cyan-300 shadow-[0_0_12px_rgba(6,182,212,0.6)] [text-shadow:0_0_8px_rgba(6,182,212,0.8)] ring-1 ring-fuchsia-500/40 hover:shadow-[0_0_16px_rgba(6,182,212,0.8)] dark:bg-black/90 dark:text-cyan-200 dark:border-cyan-300 dark:border-r-fuchsia-400 dark:border-b-fuchsia-400 cyberpunk:border-cyan-300 cyberpunk:text-cyan-200",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends
    React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };
export default Badge;
