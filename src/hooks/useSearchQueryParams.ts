'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

export interface SearchQueryValues {
  q?: string;
  category?: string;
  sort?: string;
  amenities?: string[];
  [key: string]: string | string[] | undefined;
}

export function normalizeUniqueValues(values: readonly string[] | undefined): string[] {
  if (!values || values.length === 0) return [];
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of values) {
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return Array.from(new Set(result));
}

export function serializeSearchQuery(
  values: SearchQueryValues,
  existingSearch?: string
): string {
  const params = new URLSearchParams(existingSearch ?? '');

  for (const [key, val] of Object.entries(values)) {
    if (val === undefined || val === null) {
      params.delete(key);
      continue;
    }

    if (Array.isArray(val)) {
      const unique = normalizeUniqueValues(val);
      params.delete(key);
      if (unique.length > 0) {
        params.set(key, unique.join(','));
      }
      continue;
    }

    const trimmed = String(val).trim();
    if (!trimmed) {
      params.delete(key);
    } else {
      params.set(key, trimmed);
    }
  }

  return params.toString();
}

export function parseSearchQuery(searchString: string): SearchQueryValues {
  const cleanSearch = searchString.startsWith('?') ? searchString.slice(1) : searchString;
  const params = new URLSearchParams(cleanSearch);
  const parsed: SearchQueryValues = {};

  const seenKeys = new Set<string>();
  for (const key of params.keys()) {
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);

    const allValues = params.getAll(key);
    if (key === 'amenities') {
      const splitItems = allValues.flatMap((entry) => entry.split(','));
      const uniqueAmenities = normalizeUniqueValues(splitItems);
      if (uniqueAmenities.length > 0) {
        parsed.amenities = uniqueAmenities;
      }
      continue;
    }

    const firstVal = allValues[0]?.trim();
    if (firstVal) {
      parsed[key] = firstVal;
    }
  }

  return parsed;
}

function readCurrentSearch(): string {
  if (typeof window === 'undefined') return '';
  return window.location.search.replace(/^\?/, '');
}

export function useSearchQueryParams(initialValues: SearchQueryValues = {}) {
  const [searchString, setSearchString] = useState<string>(() => {
    const current = readCurrentSearch();
    return current || serializeSearchQuery(initialValues);
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handlePopState = () => {
      setSearchString(readCurrentSearch());
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const queryParams = useMemo(() => parseSearchQuery(searchString), [searchString]);

  const setQueryParams = useCallback(
    (
      nextValues: SearchQueryValues | ((prev: SearchQueryValues) => SearchQueryValues),
      options: { replace?: boolean } = {}
    ) => {
      setSearchString((prevRaw) => {
        const prevParsed = parseSearchQuery(prevRaw);
        const resolved =
          typeof nextValues === 'function' ? nextValues(prevParsed) : nextValues;
        const serialized = serializeSearchQuery(resolved, prevRaw);

        if (serialized === prevRaw) {
          return prevRaw;
        }

        if (typeof window !== 'undefined') {
          const nextUrl = serialized
            ? `${window.location.pathname}?${serialized}`
            : window.location.pathname;
          if (options.replace) {
            window.history.replaceState(null, '', nextUrl);
          } else {
            window.history.pushState(null, '', nextUrl);
          }
        }

        return serialized;
      });
    },
    []
  );

  const toggleAmenity = useCallback(
    (amenity: string) => {
      setQueryParams((prev) => {
        const current = normalizeUniqueValues(prev.amenities);
        const exists = current.includes(amenity);
        const updated = exists
          ? current.filter((item) => item !== amenity)
          : normalizeUniqueValues([...current, amenity]);

        return {
          ...prev,
          amenities: updated,
        };
      });
    },
    [setQueryParams]
  );

  return {
    queryString: searchString,
    queryParams,
    setQueryParams,
    toggleAmenity,
  };
}

export default useSearchQueryParams;
