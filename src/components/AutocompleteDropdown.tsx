"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Building2, Zap, Clock, Users, MapPin } from "lucide-react";

interface AutocompleteDropdownProps {
  input: string;
  isOpen: boolean;
  onSelect: (suggestion: string) => void;
  onClose: () => void;
}

// Define suggestion categories and their keywords
const SUGGESTION_CATEGORIES = {
  workType: {
    label: "Work Type",
    icon: Users,
    suggestions: [
      { text: "focus mode", keywords: ["focus", "quiet", "concentrate"] },
      { text: "video calls", keywords: ["call", "zoom", "meeting", "video"] },
      {
        text: "collaboration",
        keywords: ["team", "collaborate", "group", "meeting"],
      },
      { text: "casual work", keywords: ["casual", "relax", "chill"] },
    ],
  },
  venue: {
    label: "Venue Type",
    icon: Building2,
    suggestions: [
      { text: "cafes", keywords: ["cafe", "coffee", "coffee shop"] },
      {
        text: "coworking spaces",
        keywords: ["coworking", "cowork", "workspace"],
      },
      { text: "libraries", keywords: ["library", "libraries", "quiet study"] },
    ],
  },
  amenities: {
    label: "Amenities",
    icon: Zap,
    suggestions: [
      { text: "with WiFi", keywords: ["wifi", "internet", "connection"] },
      {
        text: "with outlets",
        keywords: ["outlet", "power", "charging", "plug"],
      },
      {
        text: "quiet zone",
        keywords: ["quiet", "silent", "noise", "peaceful"],
      },
      { text: "phone booths", keywords: ["booth", "private", "phone", "call"] },
    ],
  },
  location: {
    label: "Location",
    icon: MapPin,
    suggestions: [
      { text: "near me", keywords: ["near", "nearby", "close", "around"] },
      {
        text: "within 2 miles",
        keywords: ["2 miles", "miles", "distance", "far"],
      },
      { text: "downtown", keywords: ["downtown", "center", "city"] },
    ],
  },
  time: {
    label: "Time",
    icon: Clock,
    suggestions: [
      { text: "open now", keywords: ["now", "open", "available"] },
      { text: "morning", keywords: ["morning", "early", "breakfast"] },
      { text: "evening", keywords: ["evening", "night", "late"] },
    ],
  },
};

export function AutocompleteDropdown({
  input,
  isOpen,
  onSelect,
  onClose,
}: AutocompleteDropdownProps) {
  const [filteredSuggestions, setFilteredSuggestions] = useState<
    Array<{
      category: string;
      categoryLabel: string;
      icon: React.ElementType;
      suggestions: Array<{ text: string; keywords: string[] }>;
    }>
  >([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Filter suggestions based on input
  useEffect(() => {
    if (!input.trim() || !isOpen) {
      setFilteredSuggestions([]);
      setSelectedIndex(0);
      return;
    }

    const lowerInput = input.toLowerCase();
    const filtered: typeof filteredSuggestions = [];

    Object.entries(SUGGESTION_CATEGORIES).forEach(([categoryKey, category]) => {
      const matchingSuggestions = category.suggestions.filter((suggestion) =>
        suggestion.keywords.some(
          (keyword) =>
            keyword.toLowerCase().includes(lowerInput) ||
            lowerInput.includes(keyword.toLowerCase()),
        ),
      );

      if (matchingSuggestions.length > 0) {
        filtered.push({
          category: categoryKey,
          categoryLabel: category.label,
          icon: category.icon,
          suggestions: matchingSuggestions,
        });
      }
    });

    setFilteredSuggestions(filtered);
    setSelectedIndex(0);
  }, [input, isOpen]);

  // Select a suggestion by its flattened index across all categories.
  // Declared above the keydown effect (and memoized) so it's safe to
  // reference in that effect's body and dependency array.
  const handleSelectByIndex = useCallback(
    (index: number) => {
      let currentIndex = 0;
      for (const category of filteredSuggestions) {
        for (const suggestion of category.suggestions) {
          if (currentIndex === index) {
            onSelect(suggestion.text);
            return;
          }
          currentIndex++;
        }
      }
    },
    [filteredSuggestions, onSelect],
  );

  // Handle keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen || filteredSuggestions.length === 0) return;

      const totalItems = filteredSuggestions.reduce(
        (sum, cat) => sum + cat.suggestions.length,
        0,
      );

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % totalItems);
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
          break;
        case "Enter":
          e.preventDefault();
          handleSelectByIndex(selectedIndex);
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    isOpen,
    filteredSuggestions,
    selectedIndex,
    onClose,
    handleSelectByIndex,
  ]);

  const handleSelectSuggestion = (text: string) => {
    onSelect(text);
  };

  // Render suggestions with keyboard navigation highlighting
  const renderSuggestions = () => {
    let currentIndex = 0;
    return filteredSuggestions.map((category) => (
      <div key={category.category} className="py-2">
        <div className="px-3 py-1.5 flex items-center gap-2">
          <category.icon className="w-3.5 h-3.5 text-zinc-500" />
          <span className="text-[10px] uppercase font-black tracking-widest text-zinc-500">
            {category.categoryLabel}
          </span>
        </div>
        <div className="space-y-1">
          {category.suggestions.map((suggestion) => {
            const isSelected = currentIndex === selectedIndex;
            const itemIndex = currentIndex;
            currentIndex++;

            return (
              <motion.button
                key={suggestion.text}
                type="button"
                onClick={() => handleSelectSuggestion(suggestion.text)}
                onMouseEnter={() => setSelectedIndex(itemIndex)}
                className={`w-full text-left px-3 py-2 rounded-lg text-xs font-bold uppercase tracking-tighter transition-all ${
                  isSelected
                    ? "accent-bg text-white shadow-lg"
                    : "text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                }`}
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
              >
                {suggestion.text}
              </motion.button>
            );
          })}
        </div>
      </div>
    ));
  };

  return (
    <AnimatePresence>
      {isOpen && filteredSuggestions.length > 0 && (
        <motion.div
          ref={dropdownRef}
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.15 }}
          className="absolute bottom-full mb-2 left-0 right-0 max-h-64 overflow-y-auto bg-white dark:bg-zinc-900 border-2 border-zinc-200 dark:border-zinc-800 rounded-2xl shadow-2xl z-50"
        >
          <div className="p-2">{renderSuggestions()}</div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
