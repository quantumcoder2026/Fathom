import { Suspense, lazy } from "react";

import { useStore } from "./state/store";

// The two screens pull in very different, very large dependency trees —
// globe.gl for the entry globe, three + recharts for the workspace. Splitting
// them keeps the first paint to the one the user is actually looking at.
const RegionEntry = lazy(() => import("./screens/RegionEntry"));
const Workspace = lazy(() => import("./screens/Workspace"));

function Booting() {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--mono)",
        fontSize: 11,
        letterSpacing: "0.18em",
        textTransform: "uppercase",
        color: "var(--text-faint)",
      }}
    >
      loading…
    </div>
  );
}

export default function App() {
  const screen = useStore((s) => s.screen);
  return (
    <Suspense fallback={<Booting />}>
      {screen === "entry" ? <RegionEntry /> : <Workspace />}
    </Suspense>
  );
}
