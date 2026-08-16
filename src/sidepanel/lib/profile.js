// Pure profile normalization helpers -- duplicated from lib/core.js's normalizeUserProfile rather
// than imported, matching the pre-existing pattern in the old sidepanel.js (which already duplicated
// these same functions instead of importing lib/core.js). lib/core.js is deliberately left as a
// plain, unbundled script (see vite.config.js) so background.js's classic-worker importScripts still
// works -- pulling it into the Vite/Rollup module graph here would fight that design.
export const SCAN_STATUS_KEY = "appleCareersScanStatus";
export const USER_PROFILE_KEY = "appleCareersUserProfile";
// Written directly by genericAutofill/loop.js (a plain content-script file, not part of this Vite
// module graph -- same reason SCAN_STATUS_KEY's string is duplicated in background.js rather than
// imported, see that file's header comment). Keep this literal in sync with loop.js's copy by hand.
export const GENERIC_AUTOFILL_ACTIVITY_KEY = "appleCareersGenericAutofillActivity";
// Same shape and same reuse rationale as GENERIC_AUTOFILL_ACTIVITY_KEY, but written directly by
// background.js's runApplicationWorkflow (the service worker, not a content script -- also outside
// this Vite module graph, same reason). Keep this literal in sync with background.js's copy by hand.
export const KNOWN_SITE_ACTIVITY_KEY = "appleCareersKnownSiteActivity";
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
  "addressLine2",
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

// "testing" is deliberately not a valid PERSISTED value -- see lib/core.js's copy of this function for
// why. Keep both in sync by hand, same as every other duplicated pair in this file.
const API_KEY_VALIDATION_STATUSES = ["not_tested", "valid", "invalid", "error"];
export function normalizeApiKeyValidationStatus(value) {
  return API_KEY_VALIDATION_STATUSES.includes(value) ? value : "not_tested";
}

// A cheap, non-reversible fingerprint of a string -- see lib/core.js's copy of this function (DJB2
// string hash) for the full rationale, including why this is shared between the validated API key and
// the resume the current candidateProfile was extracted from. Kept in sync by hand, same as every
// other duplicated helper in this file.
export function fingerprintText(value) {
  const text = String(value || "");
  let hash = 5381;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 33) ^ text.charCodeAt(index);
  }

  return (hash >>> 0).toString(16);
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

function normalizeStringArray(list, maxItems = 100) {
  if (!Array.isArray(list)) {
    return [];
  }
  return list.map((item) => String(item || "").trim()).filter(Boolean).slice(0, maxItems);
}

// The CandidateProfile list sections all share this shape -- see lib/core.js's copy
// (normalizeCandidateProfileEntries) for the full rationale. Kept in sync by hand.
function normalizeCandidateProfileEntries(list, { fields, arrayFields = [], requiredAnyOf, maxItems }) {
  if (!Array.isArray(list)) {
    return [];
  }

  return list
    .map((entry) => {
      const normalized = {};
      for (const field of fields) {
        normalized[field] = String(entry?.[field] || "").trim();
      }
      for (const field of arrayFields) {
        normalized[field] = normalizeStringArray(entry?.[field], 40);
      }
      return normalized;
    })
    .filter((entry) => requiredAnyOf.some((field) => entry[field]))
    .slice(0, maxItems);
}

// See lib/core.js's copy for the full rationale (Number(null) === 0 in JS, so the explicit
// null/undefined/"" check matters -- without it, "I don't know" would silently become "zero years").
// Kept in sync by hand.
function normalizeExtractedYearsOfExperience(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const years = Number(value);
  return Number.isFinite(years) && years >= 0 ? Math.min(60, years) : null;
}

// See lib/core.js's copy for the full rationale (shared between skills-defaulting and summary
// rendering so the two can't drift). Kept in sync by hand.
export const SKILL_CATEGORIES = [
  "programmingLanguages",
  "frameworks",
  "mlAi",
  "backend",
  "frontend",
  "cloud",
  "databases",
  "infrastructure",
  "distributedSystems",
  "dataEngineering",
  "protocols",
  "tools",
  "other"
];

const SKILL_CATEGORY_LABELS = {
  programmingLanguages: "Programming languages",
  frameworks: "Frameworks",
  mlAi: "ML/AI",
  backend: "Backend",
  frontend: "Frontend",
  cloud: "Cloud",
  databases: "Databases",
  infrastructure: "Infrastructure",
  distributedSystems: "Distributed systems",
  dataEngineering: "Data engineering",
  protocols: "Protocols/APIs",
  tools: "Tools",
  other: "Other"
};

function normalizeCandidateProfileSkills(skills) {
  const source = skills || {};
  const normalized = {};
  for (const category of SKILL_CATEGORIES) {
    normalized[category] = normalizeStringArray(source[category], 60);
  }
  return normalized;
}

// See lib/core.js's copy (normalizeCandidateProfile) for the full rationale -- every section defaults
// to empty/null rather than a fabricated placeholder. Kept in sync by hand.
export function normalizeCandidateProfile(candidateProfile) {
  const source = candidateProfile || {};
  const basicInfo = source.basicInfo || {};

  return {
    basicInfo: {
      fullName: String(basicInfo.fullName || "").trim(),
      email: String(basicInfo.email || "").trim(),
      phone: String(basicInfo.phone || "").trim(),
      linkedinUrl: String(basicInfo.linkedinUrl || "").trim(),
      githubUrl: String(basicInfo.githubUrl || "").trim(),
      portfolioUrl: String(basicInfo.portfolioUrl || "").trim(),
      city: String(basicInfo.city || "").trim(),
      state: String(basicInfo.state || "").trim(),
      country: String(basicInfo.country || "").trim(),
      totalYearsOfExperience: normalizeExtractedYearsOfExperience(basicInfo.totalYearsOfExperience)
    },
    professionalSummary: String(source.professionalSummary || "").trim(),
    domainExpertise: normalizeStringArray(source.domainExpertise, 20),
    skills: normalizeCandidateProfileSkills(source.skills),
    education: normalizeCandidateProfileEntries(source.education, {
      fields: ["institution", "degree", "field", "startDate", "endDate"],
      requiredAnyOf: ["institution", "degree"],
      maxItems: 20
    }),
    experience: normalizeCandidateProfileEntries(source.experience, {
      fields: ["company", "title", "startDate", "endDate", "summary"],
      arrayFields: ["responsibilities", "technologies"],
      requiredAnyOf: ["company", "title"],
      maxItems: 30
    }),
    projects: normalizeCandidateProfileEntries(source.projects, {
      fields: ["name", "description", "url"],
      arrayFields: ["technologies"],
      requiredAnyOf: ["name"],
      maxItems: 20
    }),
    certifications: normalizeCandidateProfileEntries(source.certifications, {
      fields: ["name", "issuer", "date"],
      requiredAnyOf: ["name"],
      maxItems: 20
    })
  };
}

// See lib/core.js's copy (hasCandidateProfileContent) for the full rationale -- normalizeCandidateProfile
// always returns a fully-shaped object, never null, even when nothing has been extracted, so "has
// extraction actually produced anything" needs a real content check, not a truthiness check. Kept in
// sync by hand.
export function hasCandidateProfileContent(candidateProfile) {
  if (!candidateProfile) {
    return false;
  }
  const basicInfo = candidateProfile.basicInfo || {};
  const hasAnySkill = SKILL_CATEGORIES.some((category) => candidateProfile.skills?.[category]?.length);
  return Boolean(
    candidateProfile.professionalSummary ||
      candidateProfile.domainExpertise?.length ||
      hasAnySkill ||
      candidateProfile.education?.length ||
      candidateProfile.experience?.length ||
      candidateProfile.projects?.length ||
      candidateProfile.certifications?.length ||
      basicInfo.fullName ||
      basicInfo.email ||
      basicInfo.city
  );
}

// See lib/core.js's copy for the full rationale. Kept in sync by hand.
export function candidateProfileToSummaryText(candidateProfile) {
  if (!candidateProfile) {
    return "";
  }

  const lines = [];

  if (candidateProfile.professionalSummary) {
    lines.push(candidateProfile.professionalSummary);
  }

  if (candidateProfile.domainExpertise?.length) {
    lines.push(`Domain expertise: ${candidateProfile.domainExpertise.join(", ")}`);
  }

  for (const category of SKILL_CATEGORIES) {
    const values = candidateProfile.skills?.[category];
    if (values?.length) {
      lines.push(`${SKILL_CATEGORY_LABELS[category]}: ${values.join(", ")}`);
    }
  }

  if (candidateProfile.experience?.length) {
    lines.push("Experience:");
    for (const entry of candidateProfile.experience) {
      const header = [entry.title, entry.company].filter(Boolean).join(" at ");
      const range = [entry.startDate, entry.endDate].filter(Boolean).join(" - ");
      const headerWithRange = range ? `${header} (${range})` : header;
      lines.push(`- ${headerWithRange}${entry.summary ? `: ${entry.summary}` : ""}`);
      if (entry.technologies?.length) {
        lines.push(`  Technologies: ${entry.technologies.join(", ")}`);
      }
    }
  }

  if (candidateProfile.education?.length) {
    lines.push("Education:");
    for (const entry of candidateProfile.education) {
      const degree = [entry.degree, entry.field].filter(Boolean).join(" in ");
      lines.push(`- ${[degree, entry.institution].filter(Boolean).join(", ")}`);
    }
  }

  if (candidateProfile.projects?.length) {
    lines.push("Projects:");
    for (const entry of candidateProfile.projects) {
      lines.push(`- ${entry.name}${entry.description ? `: ${entry.description}` : ""}`);
      if (entry.technologies?.length) {
        lines.push(`  Technologies: ${entry.technologies.join(", ")}`);
      }
    }
  }

  if (candidateProfile.certifications?.length) {
    lines.push("Certifications:");
    for (const entry of candidateProfile.certifications) {
      lines.push(`- ${[entry.name, entry.issuer].filter(Boolean).join(", ")}`);
    }
  }

  return lines.join("\n");
}

// See lib/core.js's copy for the full rationale. Kept in sync by hand.
export function resolveResumeProfileText(profile) {
  return candidateProfileToSummaryText(profile?.candidateProfile) || String(profile?.resumeProfile || "").trim();
}

// See lib/core.js's copy (hasLlmProviderConfigured) for the full rationale. Kept in sync by hand.
export function hasLlmProviderConfigured(profile) {
  return Boolean(profile?.llmEnabled && profile?.llmApiKey);
}

// Derived (not stored) so it always reflects the CURRENT key -- true only once llmApiKeyValidationStatus
// is "valid" AND the fingerprint that produced that status still matches the current llmApiKey. Reused
// by both useApiKeyValidation's own status derivation and any component that only needs a plain "is the
// key ready to use right now" boolean without triggering a new test (e.g. gating resume extraction).
export function isApiKeyValidated(profile) {
  return (
    Boolean(profile?.llmApiKey) &&
    profile?.llmApiKeyValidationStatus === "valid" &&
    profile?.llmApiKeyValidatedFingerprint === fingerprintText(profile?.llmApiKey)
  );
}

// Same derivation pattern as isApiKeyValidated, applied to the resume instead -- true only once a
// candidateProfile has actually been produced (fingerprint would otherwise trivially match two empty
// strings) AND its recorded fingerprint still matches the currently-uploaded resume. False the moment
// a different resume is uploaded, which is what "invalidate on new resume" reduces to.
export function isCandidateProfileFreshForResume(profile) {
  return (
    Boolean(profile?.resumeFileDataUrl) &&
    Boolean(profile?.candidateProfileResumeFingerprint) &&
    profile.candidateProfileResumeFingerprint === fingerprintText(profile.resumeFileDataUrl)
  );
}

// See lib/core.js's copy for the full rationale -- a validated API key is only required for
// auto-apply's LLM-ASSISTED matching, never for local-only auto-apply (llmEnabled left off, an
// existing supported mode). Kept in sync by hand.
export function requiresValidatedApiKeyForScan(profile) {
  return profile?.scanMode === "auto_apply" && Boolean(profile?.llmEnabled);
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
    llmApiKeyValidationStatus: "not_tested",
    llmApiKeyValidatedFingerprint: "",
    resumeProfile: "",
    candidateProfile: normalizeCandidateProfile(undefined),
    candidateProfileResumeFingerprint: "",
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
    llmApiKeyValidationStatus: normalizeApiKeyValidationStatus(profile.llmApiKeyValidationStatus),
    llmApiKeyValidatedFingerprint: String(profile.llmApiKeyValidatedFingerprint || "").trim(),
    resumeProfile: String(profile.resumeProfile || "").trim(),
    candidateProfile: normalizeCandidateProfile(profile.candidateProfile),
    candidateProfileResumeFingerprint: String(profile.candidateProfileResumeFingerprint || "").trim(),
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
