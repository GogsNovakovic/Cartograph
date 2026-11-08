# Phase 14 — Re-runs keep the map

**Goal.** Running an analysis again never costs the map it already has. The
old map stays until a new one has replaced it whole.

## Build

- **Each run's rows are its own.** Files, imports, roles and routes belong to
  the run that stored them, and the analysis names which run's rows are its
  map. Reads only ever see that run.
- **The swap is one write.** A run stores everything first, then points the
  analysis at it, with the commit, coverage and everything else the map is
  drawn from, in the same update. Before that write the old map is the map;
  after it the new one is.
- **A re-run shows the old map while it works,** with a line above it saying
  a new run is in progress and which stage it's at. When it finishes, the
  page reloads onto the new map.
- **A failed re-run leaves the old map in place** and says above it that the
  re-run failed, why, and which commit the map on screen is from, with the
  button to try again.
- **Leftover rows are cleared.** The previous map's rows are removed once the
  new one is in place, and a run's own rows are removed if it fails. Rows a
  crashed process left behind are removed when the next run starts.
- **Explanations, freshness and everything else that reads the map** read the
  run the analysis points at, and work during a re-run.

## Constraints

- **Never a mix.** No read returns rows from two runs. An import from one run
  to a file of another can't exist in the database.
- **A first run is unchanged.** An analysis with no map yet shows progress,
  then the map, or the failure, exactly as before.
- **Existing maps survive the migration** as the run they already are.

## Acceptance check

1. Open a complete map and run it again. The map stays on screen with a line
   above it following the stages; when it ends the page shows the new map.
2. Break a re-run (e.g. turn off the network once fetching starts). The old
   map is still there, with the failure and its reason above it and the
   commit it was built from.
3. Run it again with the network back. It completes and replaces the map.
4. A repository analysed for the first time behaves exactly as before.
