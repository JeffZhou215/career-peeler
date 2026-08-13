// Pure profile normalization helpers -- duplicated from lib/core.js's normalizeUserProfile rather
// than imported, matching the pre-existing pattern in the old sidepanel.js (which already duplicated
// these same functions instead of importing lib/core.js). lib/core.js is deliberately left as a
// plain, unbundled script (see vite.config.js) so background.js's classic-worker importScripts still
// works -- pulling it into the Vite/Rollup module graph here would fight that design.
export const SCAN_STATUS_KEY = "appleCareersScanStatus";
export const USER_PROFILE_KEY = "appleCareersUserProfile";
export const DEFAULT_USER_YOE = 2;
export const DEFAULT_LLM_MODEL = "gpt-4o-mini";
export const DEFAULT_SCAN_MODE = "scan_only";

// Generic autofill profile fields -- used only by "Autofill this page" (job sites outside Apple/
// TikTok/ByteDance), all plain trimmed strings.
export const GENERIC_AUTOFILL_TEXT_FIELD_KEYS = [
  "firstName",
  "lastName",
  "email",
  "phone",
  "addressLine1",
  "addressCity",
  "addressState",
  "addressPostalCode",
  "addressCountry",
  "linkedinUrl",
  "githubUrl",
  "portfolioUrl",
  "eeoGender",
  "eeoRaceEthnicity",
  "eeoVeteranStatus",
  "eeoDisabilityStatus",
  "desiredSalary",
  "availableStartDate"
];

export function normalizeUserYearsOfExperience(value) {
  const years = Number(value);

  if (!Number.isFinite(years) || years < 0) {
    return DEFAULT_USER_YOE;
  }

  return Math.min(50, years);
}

export function normalizeScanMode(value) {
  return ["scan_only", "auto_apply"].includes(value) ? value : DEFAULT_SCAN_MODE;
}

export function normalizeYesNoUnset(value) {
  return value === "yes" || value === "no" ? value : "";
}

export function normalizeNoMatchKeywords(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);
  const seen = new Set();
  const result = [];

  for (const rawTerm of list) {
    const term = String(rawTerm || "").trim();
    const key = term.toLowerCase();

    if (!term || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(term);

    if (result.length >= 50) {
      break;
    }
  }

  return result;
}

export function createDefaultProfile() {
  const genericFields = {};
  for (const key of GENERIC_AUTOFILL_TEXT_FIELD_KEYS) {
    genericFields[key] = "";
  }

  return {
    userYearsOfExperience: DEFAULT_USER_YOE,
    llmEnabled: false,
    llmApiKey: "",
    llmModel: DEFAULT_LLM_MODEL,
    resumeProfile: "",
    noMatchKeywords: [],
    scanMode: DEFAULT_SCAN_MODE,
    autoApplyConsent: false,
    ...genericFields,
    workAuthorized: "",
    requiresSponsorship: "",
    resumeFileDataUrl: "",
    resumeFileName: "",
    resumeFileType: ""
  };
}

// Applies the same normalization saveUserProfile/getUserProfile used to do on every field, given a
// raw (possibly partially-shaped) profile object -- used both when loading from storage and right
// before saving, so a stored value never bypasses validation.
export function normalizeProfile(rawProfile) {
  const profile = rawProfile || {};
  const genericFields = {};

  for (const key of GENERIC_AUTOFILL_TEXT_FIELD_KEYS) {
    genericFields[key] = String(profile[key] || "").trim();
  }

  return {
    userYearsOfExperience: normalizeUserYearsOfExperience(profile.userYearsOfExperience),
    llmEnabled: Boolean(profile.llmEnabled),
    llmApiKey: String(profile.llmApiKey || "").trim(),
    llmModel: String(profile.llmModel || DEFAULT_LLM_MODEL).trim() || DEFAULT_LLM_MODEL,
    resumeProfile: String(profile.resumeProfile || "").trim(),
    noMatchKeywords: normalizeNoMatchKeywords(profile.noMatchKeywords),
    scanMode: normalizeScanMode(profile.scanMode),
    autoApplyConsent: Boolean(profile.autoApplyConsent),
    ...genericFields,
    workAuthorized: normalizeYesNoUnset(profile.workAuthorized),
    requiresSponsorship: normalizeYesNoUnset(profile.requiresSponsorship),
    resumeFileDataUrl: String(profile.resumeFileDataUrl || "").trim(),
    resumeFileName: String(profile.resumeFileName || "").trim(),
    resumeFileType: String(profile.resumeFileType || "").trim()
  };
}

export const TECH_KEYWORD_SUGGESTIONS = [
  "Android",
  "AppKit",
  "AR/VR",
  "ASIC",
  "ASP.NET",
  "Blockchain",
  "COBOL",
  "Cocoa",
  "Cocoa Touch",
  "Core Data",
  "Cordova",
  "Device Drivers",
  "Drupal",
  "Embedded Systems",
  "Firmware",
  "Flutter",
  "Fortran",
  "FPGA",
  "Game Development",
  "Hardware Engineering",
  "IoT",
  "iOS",
  "jQuery",
  "Kernel",
  "Kotlin",
  "Mainframe",
  "macOS",
  "Networking",
  "Objective-C",
  "Perl",
  "PHP",
  "React Native",
  "Robotics",
  "RTOS",
  "Ruby",
  "Ruby on Rails",
  "Salesforce",
  "SAP",
  "Swift",
  "SwiftUI",
  "Telecom",
  "tvOS",
  "UIKit",
  "Unity",
  "Unreal Engine",
  "VB.NET",
  "Verilog",
  "VHDL",
  "watchOS",
  "Web3",
  "WordPress",
  "Xcode"
].sort((a, b) => a.localeCompare(b));
