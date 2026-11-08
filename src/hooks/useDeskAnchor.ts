import { useState, useEffect } from "react";
import { DeskAnchor, isFiniteVector3 } from "../types/ar";

export function useDeskAnchor(deskId: string | null) {
  const [anchor, setAnchor] = useState<DeskAnchor | undefined>();
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!deskId) return;

    let mounted = true;

    async function fetchAnchor() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/ar/anchors?deskId=${deskId}`);
        if (!response.ok) {
          throw new Error("Failed to fetch anchor");
        }
        const data = await response.json();
        if (mounted) {
          if (!isFiniteVector3(data?.position)) {
            throw new Error("Anchor coordinates must be finite numbers");
          }
          setAnchor(data);
        }
      } catch (err: any) {
        if (mounted) {
          setError(err.message || "Unknown error");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchAnchor();

    return () => {
      mounted = false;
    };
  }, [deskId]);

  return { anchor, loading, error };
}
