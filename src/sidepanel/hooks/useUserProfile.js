import { useCallback, useEffect, useRef, useState } from "react";
import { USER_PROFILE_KEY, createDefaultProfile, normalizeProfile } from "../lib/profile";

// Owns the single userProfile object stored under USER_PROFILE_KEY -- both the known-site settings
// (YOE, LLM, no-match keywords), shared Required Application Answers, and generic-autofill profile
// (contact info and resume) live in
// this one object, matching chrome.storage's existing schema exactly (see lib/core.js's
// normalizeUserProfile, which this mirrors).
export function useUserProfile() {
  const [profile, setProfile] = useState(createDefaultProfile);
  const [loaded, setLoaded] = useState(false);
  const profileRef = useRef(profile);
  const saveQueueRef = useRef(Promise.resolve());
  profileRef.current = profile;

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const stored = await chrome.storage.local.get(USER_PROFILE_KEY);
      if (cancelled) {
        return;
      }
      setProfile(normalizeProfile(stored[USER_PROFILE_KEY] || {}));
      setLoaded(true);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function handleStorageChange(changes, areaName) {
      if (areaName !== "local" || !changes[USER_PROFILE_KEY]) {
        return;
      }
      const next = normalizeProfile(changes[USER_PROFILE_KEY].newValue || {});
      profileRef.current = next;
      setProfile(next);
    }

    // CandidateProfile can be enriched by the background Workday workflow while the side panel is
    // open. Listening to the canonical storage record keeps the read-only Experience/Education view
    // current without introducing a second in-memory profile authority.
    chrome.storage.onChanged.addListener(handleStorageChange);
    return () => chrome.storage.onChanged.removeListener(handleStorageChange);
  }, []);

  // Merges `updates` into the current profile, normalizes, persists, and returns the resulting
  // profile -- callers that immediately need the just-saved profile (starting a scan, running
  // autofill) should use the return value rather than the possibly-stale `profile` from their own
  // render's closure.
  const save = useCallback((updates = {}) => {
    // Multiple independent controls can save at once (for example a debounced API-key validation
    // completing while resume extraction finishes). Serialize them so each merge sees the previous
    // update and storage writes cannot complete out of order and erase unrelated fields.
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      const next = normalizeProfile({ ...profileRef.current, ...updates });
      profileRef.current = next;
      setProfile(next);
      await chrome.storage.local.set({ [USER_PROFILE_KEY]: next });
      return next;
    });

    saveQueueRef.current = operation;
    return operation;
  }, []);

  return { profile, loaded, save };
}
