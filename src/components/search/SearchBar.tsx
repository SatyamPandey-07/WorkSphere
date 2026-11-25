import React, { useRef, useState } from 'react';
import {
  useGlobalSearchShortcut,
  VenueSearchInput,
} from './VenueSearchInput';

export interface SearchBarProps {
  placeholder?: string;
  initialQuery?: string;
  onSearch?: (query: string) => void;
  enableShortcut?: boolean;
  className?: string;
}

export const SearchBar: React.FC<SearchBarProps> = ({
  placeholder = 'Search venues, desks, or cities...',
  initialQuery = '',
  onSearch,
  enableShortcut = true,
  className = '',
}) => {
  const [query, setQuery] = useState(initialQuery);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const shortcutLabel = useGlobalSearchShortcut(inputRef, enableShortcut);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSearch?.(query.trim());
  };

  return (
    <form
      role="search"
      onSubmit={handleSubmit}
      className={`flex items-center gap-2 ${className}`.trim()}
    >
      <VenueSearchInput
        ref={inputRef}
        aria-label="Search venues"
        placeholder={placeholder}
        value={query}
        shortcutLabel={shortcutLabel}
        enableShortcut={enableShortcut}
        onChange={(next) => {
          setQuery(next);
          onSearch?.(next);
        }}
      />
    </form>
  );
};