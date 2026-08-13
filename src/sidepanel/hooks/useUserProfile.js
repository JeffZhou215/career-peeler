import { useCallback, useEffect, useRef, useState } from "react";
import { USER_PROFILE_KEY, createDefaultProfile, normalizeProfile } from "../lib/profile";

// Owns the single userProfile object stored under USER_PROFILE_KEY -- both the known-site settings
// (YOE, LLM, no-match keywords) and the generic-autofill profile (contact info, EEO, resume) live in
// this one object, matching chrome.storage's existing schema exactly (see lib/core.js's
// normalizeUserProfile, which this mirrors).
export function useUserProfile() {
  const [profile, setProfile] = useState(createDefaultProfile);
  const [loaded, setLoaded] = useState(false);
  const profileRef = useRef(profile);
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

  // Merges `updates` into the current profile, normalizes, persists, and returns the resulting
  // profile -- callers that immediately need the just-saved profile (starting a scan, running
  // autofill) should use the return value rather than the possibly-stale `profile` from their own
  // render's closure.
  const save = useCallback(async (updates = {}) => {
    const next = normalizeProfile({ ...profileRef.current, ...updates });
    setProfile(next);
    await chrome.storage.local.set({ [USER_PROFILE_KEY]: next });
    return next;
  }, []);

  return { profile, loaded, save };
}
