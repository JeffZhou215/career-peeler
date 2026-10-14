import { useEffect, useState } from "react";

export const SUBMISSION_SYNC_STATUS_KEY = "appleSubmissionSyncStatus";

export function watchSubmissionSyncStatus(onStatus, storage = chrome.storage) {
  let cancelled = false;
  let revision = 0;
  const listener = (changes, area) => {
    if (area !== "local" || !changes[SUBMISSION_SYNC_STATUS_KEY]) return;
    revision++;
    if (!cancelled) onStatus(changes[SUBMISSION_SYNC_STATUS_KEY].newValue || {});
  };
  storage.onChanged.addListener(listener);
  const request = revision;
  storage.local.get(SUBMISSION_SYNC_STATUS_KEY).then(stored => {
    if (!cancelled && revision === request) onStatus(stored[SUBMISSION_SYNC_STATUS_KEY] || {});
  }).catch(console.error);
  return () => { cancelled = true; storage.onChanged.removeListener(listener); };
}

export function useSubmissionSyncStatus() {
  const [status, setStatus] = useState({});
  const [now, setNow] = useState(Date.now());
  useEffect(() => watchSubmissionSyncStatus(setStatus), []);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return { status, now };
}
