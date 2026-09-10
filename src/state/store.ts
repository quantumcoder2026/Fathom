/**
 * The single Zustand store. Screen routing + all workspace state + async loaders.
 */

import { create } from "zustand";

import { api } from "../api/client";
import type {
  ComparisonResult,
  FieldMeta,
  FloatIndexItem,
  Profile,
} from "../../contracts/types";
import type { Palette } from "../three/colormap";

export interface Region {
  id: string;
  label: string;
  bbox: { lonMin: number; lonMax: number; latMin: number; latMax: number };
  hasData: boolean;
}

export const REGIONS: Region[] = [
  {
    id: "io",
    label: "Tropical Indian Ocean",
    bbox: { lonMin: 40, lonMax: 100, latMin: -25, latMax: 25 },
    hasData: true,
  },
  { id: "pac", label: "Pacific", bbox: { lonMin: -180, lonMax: -70, latMin: -60, latMax: 60 }, hasData: false },
  { id: "atl", label: "Atlantic", bbox: { lonMin: -70, lonMax: 20, latMin: -60, latMax: 65 }, hasData: false },
  { id: "so", label: "Southern Ocean", bbox: { lonMin: -180, lonMax: 180, latMin: -75, latMax: -45 }, hasData: false },
  { id: "arc", label: "Arctic", bbox: { lonMin: -180, lonMax: 180, latMin: 66, latMax: 90 }, hasData: false },
];

export type Screen = "entry" | "workspace";
export type OceanVariable = "temperature" | "salinity";

interface Colormap {
  min: number;
  max: number;
  palette: Palette;
  scale: "linear" | "log";
}

interface AppState {
  screen: Screen;
  region: Region | null;

  meta: FieldMeta | null;
  variable: OceanVariable;
  timeIndex: number;
  depthIndex: number;
  exaggeration: number;
  opacity: number;

  floats: FloatIndexItem[];
  selectedFloatId: string | null;
  profile: Profile | null;
  comparison: ComparisonResult | null;

  loading: { meta: boolean; floats: boolean; profile: boolean; comparison: boolean };
  error: string | null;

  showEvidence: boolean;
  colormap: Colormap;
  unconstrainedPct: number | null;

  enterRegion: (region: Region) => void;
  backToEntry: () => void;
  setVariable: (v: OceanVariable) => void;
  setTimeIndex: (i: number) => void;
  setDepthIndex: (i: number) => void;
  setExaggeration: (x: number) => void;
  setOpacity: (o: number) => void;
  selectFloat: (id: string | null) => void;
  toggleEvidence: () => void;
  setColormap: (patch: Partial<Colormap>) => void;
  resetColormapToRange: () => void;

  loadMeta: () => Promise<void>;
  loadFloats: () => Promise<void>;
}

const DEFAULT_COLORMAP: Colormap = { min: 2, max: 31, palette: "blue-red", scale: "linear" };

export const useStore = create<AppState>((set, get) => ({
  screen: "entry",
  region: null,

  meta: null,
  variable: "temperature",
  timeIndex: 0,
  depthIndex: 0,
  exaggeration: 8,
  opacity: 0.85,

  floats: [],
  selectedFloatId: null,
  profile: null,
  comparison: null,

  loading: { meta: false, floats: false, profile: false, comparison: false },
  error: null,

  showEvidence: false,
  colormap: DEFAULT_COLORMAP,
  unconstrainedPct: 38, // fixture-stage headline; real value comes from /evidence later

  enterRegion: (region) => {
    set({ screen: "workspace", region });
    void get().loadMeta();
    void get().loadFloats();
  },

  backToEntry: () =>
    set({ screen: "entry", selectedFloatId: null, profile: null, comparison: null }),

  setVariable: (variable) => {
    set({ variable, profile: null, comparison: null });
    const m = get().meta;
    if (m?.ranges[variable]) {
      set({ colormap: { ...get().colormap, ...m.ranges[variable] } });
    }
    const id = get().selectedFloatId;
    if (id) void loadForFloat(set, get, id);
  },

  setTimeIndex: (timeIndex) => {
    set({ timeIndex });
    void get().loadFloats();
  },

  setDepthIndex: (depthIndex) => set({ depthIndex }),
  setExaggeration: (exaggeration) => set({ exaggeration }),
  setOpacity: (opacity) => set({ opacity }),

  selectFloat: (id) => {
    set({ selectedFloatId: id, profile: null, comparison: null, error: null });
    if (id) void loadForFloat(set, get, id);
  },

  toggleEvidence: () => set({ showEvidence: !get().showEvidence }),

  setColormap: (patch) => set({ colormap: { ...get().colormap, ...patch } }),

  resetColormapToRange: () => {
    const m = get().meta;
    const r = m?.ranges[get().variable];
    if (r) set({ colormap: { ...get().colormap, min: r.min, max: r.max } });
  },

  loadMeta: async () => {
    set((s) => ({ loading: { ...s.loading, meta: true }, error: null }));
    try {
      const meta = await api.fieldMeta();
      const r = meta.ranges[get().variable] ?? { min: DEFAULT_COLORMAP.min, max: DEFAULT_COLORMAP.max };
      set((s) => ({
        meta,
        colormap: { ...s.colormap, min: r.min, max: r.max },
        depthIndex: Math.min(s.depthIndex, meta.depths.length - 1),
        timeIndex: Math.min(s.timeIndex, meta.times.length - 1),
        loading: { ...s.loading, meta: false },
      }));
    } catch (e) {
      set((s) => ({ error: String(e), loading: { ...s.loading, meta: false } }));
    }
  },

  loadFloats: async () => {
    set((s) => ({ loading: { ...s.loading, floats: true } }));
    try {
      const floats = await api.floats(get().timeIndex);
      set((s) => ({ floats, loading: { ...s.loading, floats: false } }));
    } catch (e) {
      set((s) => ({ error: String(e), loading: { ...s.loading, floats: false } }));
    }
  },
}));

// dev-only handle so the store can be driven from the console while testing
if (import.meta.env.DEV) (window as unknown as { __store?: unknown }).__store = useStore;

async function loadForFloat(
  set: (partial: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => void,
  get: () => AppState,
  id: string,
) {
  const variable = get().variable;
  set((s) => ({ loading: { ...s.loading, profile: true, comparison: true } }));
  try {
    const profile = await api.profile(id, variable);
    if (get().selectedFloatId === id) set((s) => ({ profile, loading: { ...s.loading, profile: false } }));
  } catch (e) {
    if (get().selectedFloatId === id)
      set((s) => ({ error: String(e), loading: { ...s.loading, profile: false } }));
  }
  try {
    const comparison = await api.compare(id, variable);
    if (get().selectedFloatId === id)
      set((s) => ({ comparison, loading: { ...s.loading, comparison: false } }));
  } catch (e) {
    if (get().selectedFloatId === id)
      set((s) => ({ error: String(e), loading: { ...s.loading, comparison: false } }));
  }
}
