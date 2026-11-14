"use client";

import React, { useEffect, useState } from "react";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import { VolumeX, Wifi, Layers, MapPin, Contrast } from "lucide-react";

export function CommandPalette() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const dispatchMapAction = (actionType: string, payload?: any) => {
    window.dispatchEvent(
      new CustomEvent("worksphere:map-action", {
        detail: { action: actionType, payload },
      })
    );
    setOpen(false);
  };

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or search workspace..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>

        {/* Dedicated Map Navigation Action Group */}
        <CommandGroup heading="Workspace Map Controls">
          <CommandItem
            onSelect={() => dispatchMapAction("FIND_NEAREST_QUIET_DESK")}
            className="cursor-pointer"
          >
            <VolumeX className="mr-2 h-4 w-4 text-emerald-400" />
            <span>Find nearest quiet desk</span>
          </CommandItem>

          <CommandItem
            onSelect={() => dispatchMapAction("FILTER_HIGH_SPEED_WIFI")}
            className="cursor-pointer"
          >
            <Wifi className="mr-2 h-4 w-4 text-blue-400" />
            <span>Filter by 100+ Mbps WiFi</span>
          </CommandItem>

          <CommandItem
            onSelect={() => dispatchMapAction("TOGGLE_3D_HEATMAP")}
            className="cursor-pointer"
          >
            <Layers className="mr-2 h-4 w-4 text-purple-400" />
            <span>Toggle 3D Heatmap view</span>
          </CommandItem>

          <CommandItem
            onSelect={() => dispatchMapAction("RESET_CITY_CENTER")}
            className="cursor-pointer"
          >
            <MapPin className="mr-2 h-4 w-4 text-amber-400" />
            <span>Reset map zoom to city center</span>
          </CommandItem>

          <CommandItem
            onSelect={() => dispatchMapAction("TOGGLE_HIGH_CONTRAST_BASEMAP")}
            className="cursor-pointer"
          >
            <Contrast className="mr-2 h-4 w-4 text-zinc-300" />
            <span>Switch to high contrast basemap</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

export default CommandPalette;