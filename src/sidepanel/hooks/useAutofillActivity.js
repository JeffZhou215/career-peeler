import { useEffect, useState } from "react";

const DEFAULT_ACTIVITY = { running: false, steps: [] };

// Mirrors useScanStatus.js's chrome.storage.onChanged pattern, generalized to any {running, steps}
// storage key -- genericAutofill/loop.js and background.js's runApplicationWorkflow both write steps
// straight to chrome.storage.local as they happen (no relay needed either way: a content script has
// direct storage access, and the known-site workflow runs in the service worker itself, which also
// has direct access), so this just listens rather than polling.
//
// Does one initial read on mount, unlike this hook's original genericAutofill-only version -- so
// opening the panel mid-workflow shows steps already written, not only ones from that point forward.
// This matters more for the known-site workflow, which can run for many seconds across real page
// loads, than for a generic-autofill sweep, which finishes in about the time it takes to read this
// sentence, but costs nothing extra for either case.
export function useAutofillActivity(storageKey) {
  const [activity, setActivity] = useState(DEFAULT_ACTIVITY);

  useEffect(() => {
    let cancelled = false;

    chrome.storage.local.get(storageKey).then((stored) => {
      if (!cancelled && stored[storageKey]) {
        setActivity(stored[storageKey]);
      }
    });

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local" || !changes[storageKey]) {
        return;
      }
      setActivity(changes[storageKey].newValue || DEFAULT_ACTIVITY);
    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => {
      cancelled = true;
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, [storageKey]);

  return activity;
}
