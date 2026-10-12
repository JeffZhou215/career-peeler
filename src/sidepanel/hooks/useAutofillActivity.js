import { useEffect, useState } from "react";
import { jobStore } from "../lib/jobStore";

const DEFAULT_ACTIVITY = { running: false, steps: [], cycles: [] };

// Database notifications carry keys only, keeping growing activity payloads out
// of cross-context messages. Opening the panel mid-workflow reads saved steps.
export function useAutofillActivity(storageKey) {
  const [activity, setActivity] = useState(DEFAULT_ACTIVITY);

  useEffect(() => {
    let cancelled = false;

    const refresh = () => jobStore.get(storageKey).then(stored => {
      if (!cancelled) setActivity(stored[storageKey] || DEFAULT_ACTIVITY);
    }).catch(console.error);
    refresh();

    function handleStorageChange(changes, areaName) {
      if (!["local", "indexeddb"].includes(areaName) || !changes[storageKey]) {
        return;
      }
      refresh();
    }

    jobStore.onChanged.addListener(handleStorageChange);
    return () => {
      cancelled = true;
      jobStore.onChanged.removeListener(handleStorageChange);
    };
  }, [storageKey]);

  return activity;
}
