import { useEffect, useRef, useSyncExternalStore } from "react";
import { createModelPickerController } from "../lib/modelDiscovery";
import { isApiKeyValidated } from "../lib/profile";

export function useModelDiscovery({ profile, save }) {
  const latest = useRef({ profile, save });
  latest.current = { profile, save };
  const controller = useRef(null);
  if (!controller.current) controller.current = createModelPickerController({
    getContext: () => ({ apiKey: String(latest.current.profile.llmApiKey || "").trim(),
      currentModel: latest.current.profile.llmModel || "", keyValid: isApiKeyValidated(latest.current.profile) }),
    requestModels: ({ apiKey, force }) => chrome.runtime.sendMessage({ type: "APPLE_CAREERS_LIST_OPENAI_MODELS", apiKey, force }),
    saveModel: id => latest.current.save({ llmModel: id })
  });
  const picker = controller.current;
  const state = useSyncExternalStore(picker.subscribe, picker.getSnapshot, picker.getSnapshot);
  useEffect(() => { picker.syncContext(); }, [picker, profile.llmApiKey, profile.llmModel, profile.llmApiKeyValidationStatus, profile.llmApiKeyValidatedFingerprint]);
  // React StrictMode replays effect setup/cleanup. Reactivation creates no request;
  // the cancelled generation still prevents the old request from being accepted.
  useEffect(() => { picker.activate(); return () => picker.dispose(); }, [picker]);
  return { state, picker };
}
