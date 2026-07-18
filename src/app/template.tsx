"use client";

import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname } from "next/navigation";
import { FrozenRouter } from "../components/FrozenRouter";

export default function Template({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -12 }}
        transition={{ duration: 0.22, ease: "easeInOut" }}
        className="w-full min-h-screen flex flex-col"
      >
        <FrozenRouter>{children}</FrozenRouter>
      </motion.div>
    </AnimatePresence>
  );
}
