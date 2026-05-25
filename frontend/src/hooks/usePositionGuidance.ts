import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchPositionGuidance, completePositionGuidance } from "../api/onboarding";
import type { PositionGuidance } from "../types/api";

/**
 * Fetches and caches user-authored position guidance (thesis, horizon, addOn, reduceOn, notes).
 * Provides an `updateGuidance(ticker, patch)` function that merges and re-submits the full map.
 */
export function usePositionGuidance() {
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ["position-guidance"],
    queryFn: fetchPositionGuidance,
    staleTime: 5 * 60_000,
    retry: false, // fail silently if endpoint not available
  });

  const guidanceMap: Record<string, PositionGuidance> = data?.guidance ?? {};

  const updateGuidance = async (ticker: string, patch: Partial<PositionGuidance>): Promise<void> => {
    const current = data?.guidance ?? {};
    const base: PositionGuidance = {
      thesis: "",
      horizon: "unspecified",
      addOn: "",
      reduceOn: "",
      notes: "",
      ...(current[ticker] ?? {}),
    };
    const merged: PositionGuidance = { ...base, ...patch };
    const updatedMap = { ...current, [ticker]: merged };
    await completePositionGuidance({ guidance: updatedMap });
    await queryClient.invalidateQueries({ queryKey: ["position-guidance"] });
  };

  return { guidanceMap, updateGuidance };
}
