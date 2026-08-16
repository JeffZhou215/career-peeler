import { useEffect, useRef, useState } from "react";
import { fingerprintText } from "../lib/profile";

const DEBOUNCE_MS = 800;
// A rough length floor, not a real format check (there's no one key format across providers) -- just
// enough to avoid firing the debounced auto-test against an obviously-in-progress partial key. The
// debounce timer itself (reset on every keystroke) already does most of the "wait until they're done
// typing" work; this only stops it firing early on a short prefix during a brief typing pause.
const MIN_KEY_LENGTH_TO_AUTO_TEST = 20;

// Debounced + blur/paste-triggered API key validation, layered on top of the profile's own persisted
// llmApiKeyValidationStatus/llmApiKeyValidatedFingerprint (see lib/profile.js's normalizeProfile) --
// "did the key change since it was last validated" is a fingerprint comparison against the CURRENT
// apiKey, not imperative reset-on-every-change-site code, so a still-valid key survives closing and
// reopening the panel, and a stale in-flight response for a key the user has since changed can never
// resolve into the current key's displayed status even if it arrives late (it would be saved under the
// OLD key's fingerprint, which the current key's fingerprint no longer matches). The requestId guard
// below additionally stops a late response from flipping the local "testing" flag back off after a
// newer request has already resolved.
export function useApiKeyValidation({ provider, apiKey, profile, save }) {
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState(null);
  const requestIdRef = useRef(0);
  const saveRef = useRef(save);
  saveRef.current = save;

  async function runTest(keyToTest) {
    if (!keyToTest) {
      return;
    }

    const requestId = (requestIdRef.current += 1);
    setTesting(true);

    const response = await chrome.runtime
      .sendMessage({ type: "APPLE_CAREERS_TEST_API_KEY", provider, apiKey: keyToTest })
      .catch((error) => ({ status: "error", message: error?.message || "Could not reach the extension background." }));

    if (requestId !== requestIdRef.current) {
      return; // a newer request has since started -- this result is stale, ignore it
    }

    setTesting(false);
    setMessage(response.message || null);
    await saveRef.current({
      llmApiKeyValidationStatus: response.status,
      llmApiKeyValidatedFingerprint: fingerprintText(keyToTest)
    });
  }

  // Covers both "paste" and "finish typing" -- a paste changes apiKey the same way typing does, so one
  // debounced effect handles both without a separate paste listener. Re-armed on every keystroke;
  // only actually fires once the key stops changing for DEBOUNCE_MS.
  useEffect(() => {
    if (!apiKey || apiKey.length < MIN_KEY_LENGTH_TO_AUTO_TEST) {
      return undefined;
    }

    const timer = setTimeout(() => runTest(apiKey), DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runTest reads apiKey/provider fresh from this render, not captured
  }, [apiKey, provider]);

  const fingerprintMatches = Boolean(apiKey) && profile.llmApiKeyValidatedFingerprint === fingerprintText(apiKey);
  const status = testing ? "testing" : fingerprintMatches ? profile.llmApiKeyValidationStatus : "not_tested";

  return {
    status,
    message: testing || !fingerprintMatches ? null : message,
    testNow: () => runTest(apiKey)
  };
}
