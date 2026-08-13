import { useEffect, useRef, useState } from "react";

// Decouples a controlled input's DISPLAYED value from `externalValue` while the field is focused --
// fixes a bug where typing a space did nothing. lib/profile.js's normalizeProfile trims every text
// field on every save(), and every profile-bound input calls save() on every keystroke; a controlled
// input re-renders with whatever save() returns, so a space typed at the end of the string -- exactly
// where a fresh keystroke always lands -- was being trimmed away before the next character arrived.
//
// onCommit still fires on every keystroke, same as before the fix (so nothing changes about when
// chrome.storage.local is written, and no in-progress text is lost if the panel closes mid-edit) --
// only the value bound to the input's `value` prop is decoupled, so it always shows exactly what was
// typed instead of whatever normalizeProfile trimmed it down to. Once the field blurs and the
// (possibly-trimmed) value round-trips back through `externalValue`, the draft re-syncs to match it.
export function useDraftField(externalValue, onCommit) {
  const [draft, setDraft] = useState(externalValue);
  const isFocusedRef = useRef(false);

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(externalValue);
    }
  }, [externalValue]);

  return {
    value: draft,
    onChange: (event) => {
      const nextValue = event.target.value;
      setDraft(nextValue);
      onCommit(nextValue);
    },
    onFocus: () => {
      isFocusedRef.current = true;
    },
    onBlur: () => {
      isFocusedRef.current = false;
    }
  };
}

// Thin convenience wrapper for the common case: a field bound directly to one key of the shared
// profile object. Keeps call sites that fill it out by hand (rather than through a wrapper component
// like GenericAutofillSection's TextField) to one line, so the fix above is one call away instead of
// a hand-wired pair of lines that a future raw profile-bound input could easily forget.
export function useProfileField(profile, save, key) {
  return useDraftField(profile[key], (value) => save({ [key]: value }));
}
