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
//
// That same "skip the sync while focused" guard has a second, unrelated trigger besides the user's own
// typing: an entirely external update to the SAME key, e.g. re-extracting a candidate profile while its
// multi-line "Professional summary" textarea happens to be focused because the user merely clicked in to
// read it (a resume-derived summary usually doesn't fit in three rows). No keystroke ever happened, so
// there's nothing worth protecting, but the effect above only re-syncs on `externalValue` changing --
// which already fired once and was skipped while focused -- not on blur, so without the check below the
// field would stay stuck on the pre-extraction text until some UNRELATED future save touched this same
// key again. `editedWhileFocusedRef` distinguishes the two triggers: only skip the catch-up-on-blur sync
// when the user actually typed something themselves during this focus session.
export function useDraftField(externalValue, onCommit) {
  const [draft, setDraft] = useState(externalValue);
  const isFocusedRef = useRef(false);
  const editedWhileFocusedRef = useRef(false);
  const externalValueRef = useRef(externalValue);
  externalValueRef.current = externalValue;

  useEffect(() => {
    if (!isFocusedRef.current) {
      setDraft(externalValue);
    }
  }, [externalValue]);

  return {
    value: draft,
    onChange: (event) => {
      const nextValue = event.target.value;
      editedWhileFocusedRef.current = true;
      setDraft(nextValue);
      onCommit(nextValue);
    },
    onFocus: () => {
      isFocusedRef.current = true;
      editedWhileFocusedRef.current = false;
    },
    onBlur: () => {
      isFocusedRef.current = false;
      if (!editedWhileFocusedRef.current) {
        setDraft(externalValueRef.current);
      }
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
