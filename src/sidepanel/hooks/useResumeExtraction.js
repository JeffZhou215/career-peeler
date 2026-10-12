import { useRef, useState } from "react";
import { fingerprintText, hasLlmProviderConfigured, isApiKeyValidated } from "../lib/profile";

async function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}

export function isPdfResumeFile(file) {
  return Boolean(
    file &&
    /\.pdf$/i.test(String(file.name || "")) &&
    (!file.type || ["application/pdf", "application/x-pdf"].includes(file.type.toLowerCase()))
  );
}

export function useResumeExtraction({ profile, save }) {
  const [extractionStatus, setExtractionStatus] = useState("idle");
  const [extractionError, setExtractionError] = useState(null);
  const [resumeFileError, setResumeFileError] = useState(null);
  const profileRef = useRef(profile);
  const extractionRequestIdRef = useRef(0);
  const parseRequests = useRef(new Map());
  profileRef.current = profile;

  // currentProfile is passed explicitly rather than read off the `profile` prop -- immediately after
  // a save() call, `profile` still reflects the PREVIOUS render's closure until React re-renders (see
  // rules/ui.md's useUserProfile note on why callers that need the value right away must use save()'s
  // own return value instead), and handleResumeFileChange calls this right after saving the
  // just-picked file.
  async function parseSavedResume(currentProfile = profileRef.current) {
    if (!currentProfile.resumeFileDataUrl) return currentProfile;
    const fingerprint = fingerprintText(currentProfile.resumeFileDataUrl);
    if (currentProfile.resumeText?.trim() && currentProfile.resumeTextFingerprint === fingerprint) return currentProfile;
    if (parseRequests.current.has(fingerprint)) return parseRequests.current.get(fingerprint);
    const operation = (async () => {
      setExtractionStatus("parsing");
      setExtractionError(null);
      try {
        const { extractPdfText } = await import("../lib/resumeText");
        const resumeText = await extractPdfText(currentProfile.resumeFileDataUrl);
        if (profileRef.current.resumeFileDataUrl !== currentProfile.resumeFileDataUrl) return null;
        profileRef.current = await save({ resumeText, resumeTextFingerprint: fingerprint });
        setExtractionStatus("done");
        return profileRef.current;
      } catch (error) {
        setExtractionStatus("error");
        setExtractionError(error.message || "Could not parse the PDF text.");
        return null;
      }
    })();
    parseRequests.current.set(fingerprint, operation);
    try { return await operation; } finally { parseRequests.current.delete(fingerprint); }
  }

  async function extractProfile(currentProfile) {
    if (!currentProfile.resumeFileDataUrl) {
      return;
    }

    const originalProfile = currentProfile;
    currentProfile = await parseSavedResume(currentProfile);
    if (!currentProfile) {
      if (profileRef.current.resumeFileDataUrl !== originalProfile.resumeFileDataUrl) return;
      currentProfile = profileRef.current;
    }
    const requestId = (extractionRequestIdRef.current += 1);
    const resumeFileDataUrl = currentProfile.resumeFileDataUrl;
    setExtractionStatus("extracting");
    setExtractionError(null);

    const response = await chrome.runtime
      .sendMessage({
        type: "APPLE_CAREERS_EXTRACT_CANDIDATE_PROFILE",
        resumeFileDataUrl,
        resumeFileName: currentProfile.resumeFileName,
        apiKey: currentProfile.llmApiKey,
        model: currentProfile.llmModel
      })
      .catch((error) => ({ ok: false, error: error?.message }));

    if (requestId !== extractionRequestIdRef.current) {
      return;
    }

    // The other side-panel mode uses this same hook against the same stored profile. Its file picker
    // can replace the resume while this instance's request is in flight, so request identity alone is
    // not enough; also verify the response still belongs to the currently selected PDF.
    if (profileRef.current.resumeFileDataUrl !== resumeFileDataUrl) {
      setExtractionStatus("idle");
      return;
    }

    if (response?.ok) {
      try {
        profileRef.current = await save({
          candidateProfile: response.candidateProfile,
          candidateProfileResumeFingerprint: fingerprintText(resumeFileDataUrl)
        });
        setExtractionStatus("done");
      } catch (error) {
        setExtractionStatus("error");
        setExtractionError(error?.message || "The extracted profile could not be saved to Chrome storage.");
      }
    } else {
      setExtractionStatus("error");
      setExtractionError(response?.error || "Could not extract a profile from this resume.");
    }
  }

  async function handleResumeFileChange(event) {
    const file = event.target.files?.[0];

    if (!file) {
      extractionRequestIdRef.current += 1;
      try {
        profileRef.current = await save({ resumeFileDataUrl: "", resumeFileName: "", resumeFileType: "", resumeText: "", resumeTextFingerprint: "" });
      } catch (error) {
        setResumeFileError(error?.message || "Could not clear the saved resume from Chrome storage.");
        return;
      }
      setExtractionStatus("idle");
      setExtractionError(null);
      setResumeFileError(null);
      return;
    }

    if (!isPdfResumeFile(file)) {
      event.target.value = "";
      setResumeFileError("Only PDF resume files are supported. Choose a file ending in .pdf.");
      return;
    }

    setResumeFileError(null);
    let savedProfile;

    try {
      savedProfile = await save({
        resumeFileDataUrl: await readFileAsDataUrl(file),
        resumeFileName: file.name,
        resumeFileType: file.type
      });
    } catch (error) {
      event.target.value = "";
      setResumeFileError(
        error?.message || "Could not save this PDF in Chrome extension storage. Try a smaller PDF."
      );
      return;
    }

    profileRef.current = savedProfile;
    setExtractionStatus("idle");
    setExtractionError(null);

    const selectedPdf = savedProfile.resumeFileDataUrl;
    savedProfile = await parseSavedResume(savedProfile) || profileRef.current;
    if (savedProfile.resumeFileDataUrl !== selectedPdf) return;

    // Only attempt automatically once there's a usable, VALIDATED provider -- a key that's merely
    // present but never tested (or known invalid) must not be silently retried every time a resume is
    // uploaded (see CandidateProfileSection's gating message for what the user sees instead).
    if (hasLlmProviderConfigured(savedProfile) && isApiKeyValidated(savedProfile)) {
      await extractProfile(savedProfile);
    }
  }

  return { extractionStatus, extractionError, resumeFileError, handleResumeFileChange, extractProfile, parseSavedResume };
}
