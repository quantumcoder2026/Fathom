/**
 * Typed client for the Fathom API. One function per route. No axios.
 * Base URL from VITE_API_BASE (default localhost:8000).
 */

import type {
  ComparisonResult,
  EvidenceCell,
  FieldMeta,
  FloatIndexItem,
  Profile,
  UnconstrainedSummary,
} from "../../contracts/types";

const BASE = (import.meta.env.VITE_API_BASE ?? "http://localhost:8000").replace(/\/$/, "");

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      detail = (await res.json()).detail ?? detail;
    } catch {
      /* body was not JSON */
    }
    throw new Error(`${res.status} ${detail}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  fieldMeta: (signal?: AbortSignal) => json<FieldMeta>("/field/meta", signal),

  fieldGrid: async (
    variable: string,
    timeIndex: number,
    depthIndex: number,
    signal?: AbortSignal,
  ): Promise<Float32Array> => {
    const res = await fetch(`${BASE}/field/${variable}/${timeIndex}/${depthIndex}`, { signal });
    if (!res.ok) throw new Error(`field grid ${res.status}`);
    return new Float32Array(await res.arrayBuffer());
  },

  floats: (timeIndex: number, signal?: AbortSignal) =>
    json<FloatIndexItem[]>(`/floats?t=${timeIndex}`, signal),

  profile: (floatId: string, variable: string, signal?: AbortSignal) =>
    json<Profile>(`/floats/${floatId}/profile?variable=${variable}`, signal),

  compare: (floatId: string, variable: string, signal?: AbortSignal) =>
    json<ComparisonResult>(`/compare/${floatId}?variable=${variable}`, signal),

  evidence: (
    timeIndex: number,
    depthIndex: number,
    radiusDeg: number,
    halfLifeDays: number,
    signal?: AbortSignal,
  ) =>
    json<EvidenceCell[]>(
      `/evidence?t=${timeIndex}&d=${depthIndex}&radius=${radiusDeg}&half_life=${halfLifeDays}`,
      signal,
    ),

  evidenceHeadline: (
    timeIndex: number,
    region: string,
    radiusDeg: number,
    halfLifeDays: number,
    signal?: AbortSignal,
  ) =>
    json<UnconstrainedSummary>(
      `/evidence/headline?t=${timeIndex}&region=${region}&radius=${radiusDeg}&half_life=${halfLifeDays}`,
      signal,
    ),
};

export { BASE as API_BASE };
