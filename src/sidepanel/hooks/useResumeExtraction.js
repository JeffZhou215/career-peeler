import { useState } from "react";
import { hasLlmProviderConfigured, isApiKeyValidated } from "../lib/profile";

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

// Shared by GenericAutofillSection.jsx and KnownSitesSection.jsx -- both need the same "upload a
// resume, extract a CandidateProfile from it" behavior (the known-site auto-apply flow actually
// consumes the result via startListScan's own gating; generic autofill uses it to ground field
// mapping/LLM answers), so this lives in one hook instead of two independently-written copies of the
// same upload/extraction logic.
export function useResumeExtraction({ profile, save }) {
  const [extractionStatus, setExtractionStatus] = useState("idle");
  const [extractionError, setExtractionError] = useState(null);

  // currentProfile is passed explicitly rather than read off the `profile` prop -- immediately after
  // a save() call, `profile` still reflects the PREVIOUS render's closure until React re-renders (see
  // rules/ui.md's useUserProfile note on why callers that need the value right away must use save()'s
  // own return value instead), and handleResumeFileChange calls this right after saving the
  // just-picked file.
  async function extractProfile(currentProfile) {
    if (!currentProfile.resumeFileDataUrl) {
      return;
    }

    setExtractionStatus("extracting");
    setExtractionError(null);

    const response = await chrome.runtime
      .sendMessage({
        type: "APPLE_CAREERS_EXTRACT_CANDIDATE_PROFILE",
        resumeFileDataUrl: currentProfile.resumeFileDataUrl,
        resumeFileName: currentProfile.resumeFileName,
        apiKey: currentProfile.llmApiKey,
        model: currentProfile.llmModel
      })
      .catch((error) => ({ ok: false, error: error?.message }));

    if (response?.ok) {
      await save({ candidateProfile: response.candidateProfile });
      setExtractionStatus("done");
    } else {
      setExtractionStatus("error");
      setExtractionError(response?.error || "Could not extract a profile from this resume.");
    }
  }

  async function handleResumeFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      await save({ resumeFileDataUrl: "", resumeFileName: "", resumeFileType: "" });
      setExtractionStatus("idle");
      setExtractionError(null);
      return;
    }

    const savedProfile = await save({ resumeFileDataUrl: await readFileAsDataUrl(file), resumeFileName: file.name, resumeFileType: file.type });
    setExtractionStatus("idle");
    setExtractionError(null);

    // Only attempt automatically once there's a usable, VALIDATED provider -- a key that's merely
    // present but never tested (or known invalid) must not be silently retried every time a resume is
    // uploaded (see CandidateProfileSection's gating message for what the user sees instead).
    if (hasLlmProviderConfigured(savedProfile) && isApiKeyValidated(savedProfile)) {
      await extractProfile(savedProfile);
    }
  }

  return { extractionStatus, extractionError, handleResumeFileChange, extractProfile };
}
