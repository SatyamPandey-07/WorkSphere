import { useState, useEffect, useCallback, useRef } from "react";

export interface FavoriteTag {
  id: string;
  favoriteId: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface SavedVenue {
  id: string;
  userId: string;
  venueId: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  venue: {
    id: string;
    placeId: string;
    name: string;
    latitude: number;
    longitude: number;
    category: string;
    address: string | null;
    rating: number | null;
    wifiQuality: number | null;
    hasOutlets: boolean;
    noiseLevel: string | null;
    imageUrl: string | null;
  };
  tags: FavoriteTag[];
}

interface UseSavedVenuesReturn {
  favorites: SavedVenue[];
  loading: boolean;
  error: string | null;
  allTags: FavoriteTag[];
  refresh: () => Promise<void>;
  updateNotes: (favoriteId: string, notes: string | null) => Promise<void>;
  addTag: (
    favoriteId: string,
    name: string,
    color: string,
  ) => Promise<FavoriteTag>;
  updateTag: (
    favoriteId: string,
    tagId: string,
    data: { name?: string; color?: string },
  ) => Promise<void>;
  deleteTag: (favoriteId: string, tagId: string) => Promise<void>;
  removeFavorite: (venueId: string) => Promise<void>;
}

async function safeJson(res: Response): Promise<unknown> {
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (res.status === 401 || res.status === 302) {
      throw new Error("Session expired. Please sign in again.");
    }
    if (res.status === 404) {
      throw new Error("Resource not found.");
    }
    throw new Error("Unexpected response from server.");
  }
  return res.json();
}

function isFetchError(err: unknown): boolean {
  return err instanceof TypeError && "message" in err;
}

let tagIdCounter = 0;

export function useSavedVenues(): UseSavedVenuesReturn {
  const [favorites, setFavorites] = useState<SavedVenue[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const favoritesRef = useRef(favorites);

  useEffect(() => {
    favoritesRef.current = favorites;
  }, [favorites]);

  const refresh = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch("/api/favorites", { redirect: "manual" });

      if (res.type === "opaqueredirect" || !res.ok) {
        throw new Error("Failed to fetch saved venues");
      }

      const data = (await safeJson(res)) as { favorites?: SavedVenue[] };
      setFavorites(data.favorites || []);
    } catch (err) {
      if (isFetchError(err)) {
        setError("Network error. Please check your connection.");
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const revalidateTags = useCallback(async (favoriteId: string) => {
    try {
      const res = await fetch(`/api/favorites/${favoriteId}/tags`, {
        redirect: "manual",
      });
      if (res.type === "opaqueredirect" || !res.ok) return;
      const data = (await safeJson(res)) as { tags: FavoriteTag[] };
      setFavorites((prev) =>
        prev.map((f) => (f.id === favoriteId ? { ...f, tags: data.tags } : f)),
      );
    } catch (err) {
      console.error("Failed to revalidate tags:", err);
    }
  }, []);

  const allTags: FavoriteTag[] = favorites.flatMap((f) => f.tags);

  const updateNotes = useCallback(
    async (favoriteId: string, notes: string | null) => {
      const previous = favoritesRef.current;
      const previousNotes = previous.find((f) => f.id === favoriteId)?.notes;
      setFavorites((prev) =>
        prev.map((f) => (f.id === favoriteId ? { ...f, notes } : f)),
      );

      try {
        const res = await fetch(`/api/favorites/${favoriteId}/notes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes }),
          redirect: "manual",
        });

        if (res.type === "opaqueredirect") {
          throw new Error("Session expired. Please sign in again.");
        }

        if (!res.ok) {
          const data = (await safeJson(res)) as { error?: string };
          throw new Error(data.error || "Failed to update notes");
        }

        const data = (await safeJson(res)) as {
          favorite: { notes: string | null; updatedAt: string };
        };
        setFavorites((prev) =>
          prev.map((f) =>
            f.id === favoriteId
              ? {
                  ...f,
                  notes: data.favorite.notes,
                  updatedAt: data.favorite.updatedAt,
                }
              : f,
          ),
        );
      } catch (err) {
        setFavorites((prev) =>
          prev.map((f) =>
            f.id === favoriteId ? { ...f, notes: previousNotes ?? null } : f,
          ),
        );
        throw err;
      }
    },
    [],
  );

  const addTag = useCallback(
    async (
      favoriteId: string,
      name: string,
      color: string,
    ): Promise<FavoriteTag> => {
      const tempId = `temp-${++tagIdCounter}`;
      const optimisticTag: FavoriteTag = {
        id: tempId,
        favoriteId,
        name,
        color,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      setFavorites((prev) =>
        prev.map((f) =>
          f.id === favoriteId ? { ...f, tags: [...f.tags, optimisticTag] } : f,
        ),
      );

      try {
        const res = await fetch(`/api/favorites/${favoriteId}/tags`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, color }),
          redirect: "manual",
        });

        if (res.type === "opaqueredirect") {
          throw new Error("Session expired. Please sign in again.");
        }

        if (!res.ok) {
          const data = (await safeJson(res)) as { error?: string };
          throw new Error(data.error || "Failed to add tag");
        }

        const data = (await safeJson(res)) as { tag: FavoriteTag };
        setFavorites((prev) =>
          prev.map((f) =>
            f.id === favoriteId
              ? {
                  ...f,
                  tags: f.tags.map((t) => (t.id === tempId ? data.tag : t)),
                }
              : f,
          ),
        );
        revalidateTags(favoriteId).catch(console.error);
        return data.tag;
      } catch (err) {
        setFavorites((prev) =>
          prev.map((f) =>
            f.id === favoriteId
              ? { ...f, tags: f.tags.filter((t) => t.id !== tempId) }
              : f,
          ),
        );
        throw err;
      }
    },
    [revalidateTags],
  );

  const updateTag = useCallback(
    async (
      favoriteId: string,
      tagId: string,
      tagData: { name?: string; color?: string },
    ) => {
      const previous = favoritesRef.current
        .find((f) => f.id === favoriteId)
        ?.tags.find((t) => t.id === tagId);
      setFavorites((prev) =>
        prev.map((f) =>
          f.id === favoriteId
            ? {
                ...f,
                tags: f.tags.map((t) =>
                  t.id === tagId
                    ? { ...t, ...tagData, updatedAt: new Date().toISOString() }
                    : t,
                ),
              }
            : f,
        ),
      );

      try {
        const res = await fetch(`/api/favorites/${favoriteId}/tags/${tagId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(tagData),
          redirect: "manual",
        });

        if (res.type === "opaqueredirect") {
          throw new Error("Session expired. Please sign in again.");
        }

        if (!res.ok) {
          const data = (await safeJson(res)) as { error?: string };
          throw new Error(data.error || "Failed to update tag");
        }

        const data = (await safeJson(res)) as { tag: FavoriteTag };
        setFavorites((prev) =>
          prev.map((f) =>
            f.id === favoriteId
              ? {
                  ...f,
                  tags: f.tags.map((t) => (t.id === tagId ? data.tag : t)),
                }
              : f,
          ),
        );
        revalidateTags(favoriteId).catch(console.error);
      } catch (err) {
        setFavorites((prev) =>
          prev.map((f) =>
            f.id === favoriteId
              ? {
                  ...f,
                  tags: f.tags.map((t) =>
                    t.id === tagId && previous ? previous : t,
                  ),
                }
              : f,
          ),
        );
        throw err;
      }
    },
    [revalidateTags],
  );

  const deleteTag = useCallback(
    async (favoriteId: string, tagId: string) => {
      const previous =
        favoritesRef.current.find((f) => f.id === favoriteId)?.tags ?? [];
      setFavorites((prev) =>
        prev.map((f) =>
          f.id === favoriteId
            ? { ...f, tags: f.tags.filter((t) => t.id !== tagId) }
            : f,
        ),
      );

      try {
        const res = await fetch(`/api/favorites/${favoriteId}/tags/${tagId}`, {
          method: "DELETE",
          redirect: "manual",
        });

        if (res.type === "opaqueredirect") {
          throw new Error("Session expired. Please sign in again.");
        }

        if (!res.ok) {
          const data = (await safeJson(res)) as { error?: string };
          throw new Error(data.error || "Failed to delete tag");
        }
        revalidateTags(favoriteId).catch(console.error);
      } catch (err) {
        setFavorites((prev) =>
          prev.map((f) => (f.id === favoriteId ? { ...f, tags: previous } : f)),
        );
        throw err;
      }
    },
    [revalidateTags],
  );

  const removeFavorite = useCallback(
    async (venueId: string) => {
      setFavorites((prev) => prev.filter((f) => f.venueId !== venueId));

      try {
        const res = await fetch(`/api/favorites?venueId=${venueId}`, {
          method: "DELETE",
          redirect: "manual",
        });

        if (res.type === "opaqueredirect") {
          throw new Error("Session expired. Please sign in again.");
        }

        if (!res.ok) {
          throw new Error("Failed to remove favorite");
        }
      } catch (err) {
        await refresh();
        throw err;
      }
    },
    [refresh],
  );

  return {
    favorites,
    loading,
    error,
    allTags,
    refresh,
    updateNotes,
    addTag,
    updateTag,
    deleteTag,
    removeFavorite,
  };
}
