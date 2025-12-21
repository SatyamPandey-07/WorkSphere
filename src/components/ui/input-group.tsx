"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

const InputGroup = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center rounded-md border bg-background ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
      className
    )}
    {...props}
  />
))
InputGroup.displayName = "InputGroup"

const InputGroupInput = React.forwardRef<
  HTMLInputElement,
  React.InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    className={cn(
      "flex h-10 w-full bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none disabled:cursor-not-allowed disabled:opacity-50",
      className
    )}
    {...props}
  />
))
InputGroupInput.displayName = "InputGroupInput"

const InputGroupTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentPropsWithoutRef<typeof Textarea>
>(({ className, ...props }, ref) => (
  <Textarea
    ref={ref}
    className={cn(
      "min-h-0 resize-none border-0 bg-transparent focus-visible:ring-0 focus-visible:ring-offset-0",
      className
    )}
    {...props}
  />
))
InputGroupTextarea.displayName = "InputGroupTextarea"

const InputGroupButton = React.forwardRef<
  HTMLButtonElement,
  React.ComponentPropsWithoutRef<typeof Button>
>(({ className, ...props }, ref) => (
  <Button
    ref={ref}
    className={cn("shrink-0", className)}
    {...props}
  />
))
InputGroupButton.displayName = "InputGroupButton"

const InputGroupAddon = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    align?: "block-start" | "block-end" | "inline-start" | "inline-end"
  }
>(({ className, align, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "flex items-center px-3 text-sm text-muted-foreground",
      align === "block-start" && "order-first w-full",
      align === "block-end" && "order-last w-full",
      align === "inline-start" && "order-first",
      align === "inline-end" && "order-last",
      className
    )}
    {...props}
  />
))
InputGroupAddon.displayName = "InputGroupAddon"

export { InputGroup, InputGroupInput, InputGroupTextarea, InputGroupButton, InputGroupAddon }
