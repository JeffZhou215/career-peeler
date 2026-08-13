import { useCallback, useEffect, useState } from "react";
import { SCAN_STATUS_KEY } from "../lib/profile";

export function useScanStatus() {
  // {} rather than null -- ScanStatusPanel's fields all default via `|| 0`/`?? 0`, so an empty object
  // renders the same all-zero panel the old static HTML showed before the first refresh completed.
  const [status, setStatus] = useState({});

  const refresh = useCallback(async () => {
    const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_GET_SCAN_STATUS" });
    if (response?.ok) {
      setStatus(response.status);
    }
    return response;
  }, []);

  useEffect(() => {
    refresh();

    function handleStorageChange(changes, areaName) {
      if (areaName !== "local" || !changes[SCAN_STATUS_KEY]?.newValue) {
        return;
      }
      setStatus(changes[SCAN_STATUS_KEY].newValue);
    }

    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, [refresh]);

  // Polls once a second only while a scan is actually running, mirroring the old
  // startPollingScanStatus/clearInterval pair -- starts/stops automatically as status.running flips.
  useEffect(() => {
    if (!status?.running) {
      return undefined;
    }

    const intervalId = setInterval(refresh, 1000);
    return () => clearInterval(intervalId);
  }, [status?.running, refresh]);

  return { status, refresh, setStatus };
}
