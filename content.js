const WORD_NUMBERS = new Map([
  ["one", 1],
  ["two", 2],
  ["three", 3],
  ["four", 4],
  ["five", 5],
  ["six", 6],
  ["seven", 7],
  ["eight", 8],
  ["nine", 9],
  ["ten", 10]
]);

const REQUIREMENT_HEADINGS = [
  "minimum qualifications",
  "preferred qualifications",
  "key qualifications",
  "requirements",
  "required experience",
  "education & experience",
  "education and experience"
];

const RESUME_KEYWORDS = [
  { label: "Python", terms: ["python"], weight: 4 },
  { label: "PyTorch", terms: ["pytorch"], weight: 5 },
  { label: "Transformers", terms: ["transformers", "transformer models"], weight: 5 },
  { label: "RAG", terms: ["rag", "retrieval-augmented generation", "retrieval augmented generation"], weight: 5 },
  { label: "LLMs", terms: ["llm", "llms", "large language model", "large language models"], weight: 5 },
  { label: "Vision-Language Models", terms: ["vision-language", "vision language", "vlm", "vlms", "multimodal"], weight: 5 },
  { label: "Image Generation", terms: ["image generation", "generative ai", "gen ai", "diffusion"], weight: 4 },
  { label: "Embeddings", terms: ["embedding", "embeddings", "similarity search", "cosine similarity"], weight: 4 },
  { label: "Machine Learning", terms: ["machine learning", "ml", "ai/ml", "artificial intelligence", "ai"], weight: 4 },
  {
    label: "AI Product Experiences",
    terms: ["ai experiences", "ai experience", "gen ai", "generative ai", "ai products", "ai features", "intelligent experiences"],
    weight: 5
  },
  { label: "Computer Vision", terms: ["computer vision", "vision products", "image classification"], weight: 4 },
  { label: "C#/.NET", terms: ["c#", ".net", "dotnet", "asp.net"], weight: 5 },
  { label: "Angular", terms: ["angular", "typescript"], weight: 4 },
  { label: "AWS", terms: ["aws", "cloudwatch", "lambda", "eventbridge", "sqs"], weight: 5 },
  { label: "DynamoDB", terms: ["dynamodb"], weight: 4 },
  { label: "Terraform", terms: ["terraform", "infrastructure as code", "iac"], weight: 4 },
  { label: "Microservices", terms: ["microservice", "microservices", "distributed systems"], weight: 5 },
  {
    label: "Backend/API Engineering",
    terms: ["backend", "back-end", "api", "apis", "rest", "service", "services", "server-side", "server side"],
    weight: 5
  },
  {
    label: "Full Stack Engineering",
    terms: ["full stack", "full-stack", "frontend", "front-end", "web application", "web app", "ui"],
    weight: 4
  },
  {
    label: "Event/Queue Systems",
    terms: ["queue", "queues", "message queue", "messaging", "event-driven", "event driven", "eventbridge", "sqs"],
    weight: 5
  },
  {
    label: "Cloud Infrastructure",
    terms: ["cloud infrastructure", "infrastructure", "scalability", "reliability", "observability", "monitoring"],
    weight: 4
  },
  { label: "JavaScript", terms: ["javascript", "node.js", "nodejs", "react"], weight: 2 },
  { label: "Java/C++", terms: ["java", "c++", "c programming"], weight: 2 },
  { label: "SQL/Databases", terms: ["sql", "mysql", "mongodb", "database"], weight: 2 },
  { label: "Testing/APIs", terms: ["swagger", "postman", "unit testing", "integration testing"], weight: 2 },
  {
    label: "QA/Test Automation",
    terms: [
      "qa",
      "quality assurance",
      "software qa",
      "test automation",
      "automated testing",
      "automation testing",
      "test engineer",
      "testing framework",
      "jasmine",
      "mstest",
      "blazemeter"
    ],
    weight: 5
  }
];

const DOMAIN_MISMATCH_RULES = [
  {
    label: "iOS app development",
    terms: ["ios", "objective-c", "objective c", "uikit", "swiftui", "xcode", "cocoa touch"],
    penalty: 16
  },
  {
    label: "macOS app development",
    terms: ["appkit", "cocoa", "core data"],
    penalty: 10
  },
  {
    label: "mobile app UI",
    terms: ["mobile app", "mobile applications", "client app", "native app"],
    penalty: 8
  },
  {
    label: "embedded/driver development",
    terms: ["firmware", "kernel", "device driver", "drivers", "embedded"],
    penalty: 8
  }
];

const SENIORITY_RULES = [
  { label: "senior title", terms: ["senior software engineer", "sr. software engineer", "senior engineer"], penalty: 6 },
  { label: "staff/principal title", terms: ["staff engineer", "principal engineer", "lead engineer"], penalty: 10 },
  { label: "high ownership requirement", terms: ["technical lead", "leadership", "mentor junior", "architect"], penalty: 4 }
];

const MISMATCH_OVERRIDES = [
  "machine learning",
  "ml",
  "ai",
  "computer vision",
  "infrastructure",
  "distributed systems",
  "backend",
  "cloud",
  "data",
  "platform",
  "full stack",
  "full-stack",
  "api",
  "service",
  "microservices",
  "queue",
  "event-driven",
  "scalability",
  "reliability",
  "qa",
  "quality assurance",
  "test automation"
];

const SITE_CONFIGS = {
  apple: {
    id: "apple",
    label: "Apple Careers",
    isSupportedUrl: (url) =>
      url?.origin === "https://jobs.apple.com" ||
      (url?.origin === "https://www.apple.com" && /^\/careers(?:\/|$)/i.test(url.pathname)),
    isJobDetailUrl: (url) => url?.origin === "https://jobs.apple.com" && /\/details\//i.test(url.pathname),
    isApplicationUrl: () => false,
    applyPattern: /^submit resume$/i,
    continuePattern: /^continue$/i,
    finalSubmitPattern: /^submit$/i,
    primaryActionId: "apply-step-continue-button",
    titleSuffixPattern: /\s+-\s+(?:Jobs\s+-\s+)?Careers at Apple\.?$/i
  },
  tiktok: {
    id: "tiktok",
    label: "TikTok/ByteDance Careers",
    isSupportedUrl: (url) =>
      [
        "careers.tiktok.com",
        "lifeattiktok.com",
        "jobs.bytedance.com",
        "careers.bytedance.com",
        "joinbytedance.com"
      ].includes(url?.hostname || ""),
    isJobDetailUrl: (url) => {
      const pathname = url?.pathname || "";

      return (
        /^\/(?:[^/]+\/)?position\/\d+(?:\/|$)/i.test(pathname) ||
        /^\/(?:[^/]+\/)?jobs?\/\d+(?:\/|$)/i.test(pathname) ||
        (["lifeattiktok.com", "joinbytedance.com"].includes(url?.hostname || "") &&
          /^\/search\/\d+$/i.test(pathname))
      );
    },
    isApplicationUrl: (url) => /\/resume\/[^/?#]+\/apply(?:\/|$)?/i.test(url?.pathname || ""),
    applyPattern: /^(apply|apply now|apply for this job|apply to this job|submit application)$/i,
    continuePattern: /^(continue|next|save and continue|save & continue)$/i,
    finalSubmitPattern: /^(submit|submit application|send application)$/i,
    titleSuffixPattern: /\s+-\s+(?:TikTok|ByteDance)\s*(?:Careers|Jobs)?\.?$/i
  }
};

const WORKFLOW_STEP_DELAY_MS = 1800;
const WORKFLOW_WAIT_TIMEOUT_MS = 12000;
const DEFAULT_USER_YOE = 2;
const TEXT_NODE_TYPE = 3;
const HIGH_YOE_HARD_SKIP_FLOOR = 8;
const HIGH_YOE_HARD_SKIP_BUFFER = 3;

const REQUIRED_SECTION_PATTERN =
  /\b(minimum qualifications?|basic qualifications?|required qualifications?|requirements?|required experience|education (?:&|and) experience|key qualifications?)\b/i;
const PREFERRED_SECTION_PATTERN =
  /\b(preferred qualifications?|preferred experience|nice to have|bonus qualifications?)\b/i;
const SECTION_HEADING_TERMS =
  "Description|Responsibilities|Minimum Qualifications?|Basic Qualifications?|Required Qualifications?|Requirements?|Required Experience|Education (?:&|and) Experience|Key Qualifications?|Preferred Qualifications?|Preferred Experience|Nice to Have|Bonus Qualifications?";
const EXACT_SECTION_HEADING_PATTERN = new RegExp(`^(${SECTION_HEADING_TERMS})$`, "i");

function createSectionHeadingPattern() {
  return new RegExp(`\\b(${SECTION_HEADING_TERMS})\\b`, "gi");
}

function normalizeText(text) {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getCurrentUrl() {
  return new URL(window.location.href);
}

function getSiteConfig(url = getCurrentUrl()) {
  return Object.values(SITE_CONFIGS).find((site) => site.isSupportedUrl(url)) || null;
}

function getSiteId(url = getCurrentUrl()) {
  return getSiteConfig(url)?.id || "unknown";
}

function getSiteLabel(url = getCurrentUrl()) {
  return getSiteConfig(url)?.label || "Unsupported site";
}

function isSupportedJobDetailUrl(url) {
  return Boolean(getSiteConfig(url)?.isJobDetailUrl(url));
}

function getElementOwnText(element) {
  return Array.from(element.childNodes || [])
    .filter((node) => node.nodeType === TEXT_NODE_TYPE)
    .map((node) => node.textContent)
    .join(" ");
}

function findSectionContainer(element) {
  let current = element.parentElement;

  for (let depth = 0; current && depth < 6; depth += 1) {
    const text = normalizeText(current.innerText || "");

    if (text.length > 80 && /\b(years?|yrs?|experience|qualifications?|responsibilities)\b/i.test(text)) {
      return current;
    }

    current = current.parentElement;
  }

  return element.parentElement;
}

function getStructuredJobSectionText() {
  const sections = [];
  const seen = new Set();

  for (const element of document.querySelectorAll("h2, h3, h4, [class*='section'], [class*='qualification'], div, span")) {
    if (!isElementVisible(element)) {
      continue;
    }

    const heading = normalizeText(getElementOwnText(element) || element.innerText || "");

    if (!EXACT_SECTION_HEADING_PATTERN.test(heading)) {
      continue;
    }

    const container = findSectionContainer(element);
    const containerText = normalizeText(container?.innerText || "");

    if (!containerText || seen.has(containerText)) {
      continue;
    }

    seen.add(containerText);
    sections.push(containerText);
  }

  return sections.join("\n");
}

function getVisiblePageText() {
  return normalizeText(`${getStructuredJobSectionText()}\n${document.body?.innerText || ""}`);
}

function getJobId() {
  return getJobIdFromUrl(window.location.href);
}

function getJobIdFromUrl(url) {
  try {
    const parsedUrl = new URL(url);
    const pathPatterns = [
      /\/details\/([^/?#]+)/i,
      /\/position\/([^/?#]+)/i,
      /\/resume\/([^/?#]+)/i,
      /\/search\/([^/?#]+)/i,
      /\/job\/([^/?#]+)/i,
      /\/jobs\/([^/?#]+)/i
    ];

    for (const pattern of pathPatterns) {
      const match = parsedUrl.pathname.match(pattern);
      if (match?.[1]) {
        return decodeURIComponent(match[1]);
      }
    }

    for (const param of ["job_id", "jobId", "id", "position_id", "positionId", "req_id", "reqId"]) {
      const value = parsedUrl.searchParams.get(param);
      if (value) {
        return value;
      }
    }

    return parsedUrl.href;
  } catch (_error) {
    return url;
  }
}

function cleanTitle(title) {
  const siteConfig = getSiteConfig();
  return normalizeText(title || "")
    .replace(SITE_CONFIGS.apple.titleSuffixPattern, "")
    .replace(SITE_CONFIGS.tiktok.titleSuffixPattern, "")
    .replace(siteConfig?.titleSuffixPattern || /$^/, "")
    .replace(/\s*[>›»]\s*$/u, "")
    .trim();
}

function getJobTitle() {
  return cleanTitle(document.querySelector("h1")?.innerText || document.title);
}

function isElementVisible(element) {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.visibility !== "hidden" &&
    style.display !== "none"
  );
}

function splitSentences(text) {
  return normalizeText(text)
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

function sentenceMentionsRequirement(sentence) {
  const lower = sentence.toLowerCase();
  return (
    /\b(years?|yrs?)\b/.test(lower) &&
    /\b(experience|professional|industry|software|engineering|development|work)\b/.test(lower)
  );
}

function parseYears(sentence) {
  const years = [];
  const numericPattern = /\b(\d{1,2})\+?\s*(?:\+?\s*)?(?:years?|yrs?)\b/gi;
  let numericMatch = numericPattern.exec(sentence);

  while (numericMatch) {
    years.push(Number(numericMatch[1]));
    numericMatch = numericPattern.exec(sentence);
  }

  for (const [word, value] of WORD_NUMBERS.entries()) {
    const wordPattern = new RegExp(`\\b${word}\\+?\\s+(?:years?|yrs?)\\b`, "i");
    if (wordPattern.test(sentence)) {
      years.push(value);
    }
  }

  return years;
}

function classifyMatchType(sentence) {
  const lower = sentence.toLowerCase();

  if (/\b(preferred|preferably|nice to have|plus)\b/.test(lower)) {
    return "preferred";
  }

  if (/\b(minimum|required|requires|must have|at least|need)\b/.test(lower)) {
    return "required";
  }

  return "mentioned";
}

function classifyRequirementSection(line) {
  const lower = line.toLowerCase();

  if (PREFERRED_SECTION_PATTERN.test(lower)) {
    return "preferred";
  }

  if (REQUIRED_SECTION_PATTERN.test(lower)) {
    return "required";
  }

  return null;
}

function splitRequirementSections(text) {
  const sections = [];
  const sectionPattern = createSectionHeadingPattern();
  let currentType = null;
  let currentStart = 0;
  let match = sectionPattern.exec(text);

  while (match) {
    if (match.index > currentStart) {
      sections.push({
        type: currentType,
        text: text.slice(currentStart, match.index)
      });
    }

    currentType = classifyRequirementSection(match[0]);
    currentStart = match.index + match[0].length;
    match = sectionPattern.exec(text);
  }

  sections.push({
    type: currentType,
    text: text.slice(currentStart)
  });

  return sections.filter((section) => section.text.trim());
}

function getMaxYears(matches, predicate = () => true) {
  const years = matches.filter(predicate).flatMap((match) => match.years);

  return years.length ? Math.max(...years) : null;
}

function getEffectiveMatchType(sentence, sectionType) {
  const sentenceType = classifyMatchType(sentence);

  return sentenceType === "mentioned" && sectionType ? sectionType : sentenceType;
}

function extractExperienceMatches(text) {
  const matches = [];
  let sectionType = null;

  for (const line of normalizeText(text).split("\n")) {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      continue;
    }

    const lineSectionType = classifyRequirementSection(trimmedLine);
    sectionType = lineSectionType || sectionType;

    for (const section of splitRequirementSections(trimmedLine)) {
      const effectiveSectionType = section.type || sectionType;

      for (const sentence of splitSentences(section.text)) {
        if (!sentenceMentionsRequirement(sentence)) {
          continue;
        }

        const years = parseYears(sentence);

        if (years.length === 0) {
          continue;
        }

        matches.push({
          sentence,
          years,
          type: getEffectiveMatchType(sentence, effectiveSectionType)
        });
      }
    }
  }

  return matches;
}

function extractRequirementPreview(text) {
  const lines = normalizeText(text).split("\n");
  const startIndex = lines.findIndex((line) =>
    REQUIREMENT_HEADINGS.some((heading) => line.toLowerCase().includes(heading))
  );

  if (startIndex === -1) {
    return lines.slice(0, 24).join("\n");
  }

  return lines.slice(startIndex, startIndex + 36).join("\n");
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textIncludesTerm(text, term) {
  const normalizedText = text.toLowerCase();
  const normalizedTerm = term.toLowerCase();

  if (/^[a-z0-9\s-]+$/i.test(normalizedTerm)) {
    const pattern = new RegExp(`\\b${escapeRegExp(normalizedTerm)}\\b`, "i");
    return pattern.test(normalizedText);
  }

  return normalizedText.includes(normalizedTerm);
}

function analyzeResumeMatch(text) {
  const matched = RESUME_KEYWORDS.filter((keyword) =>
    keyword.terms.some((term) => textIncludesTerm(text, term))
  );
  const score = matched.reduce((total, keyword) => total + keyword.weight, 0);
  const percentage = Math.min(100, Math.round((score / 30) * 100));

  return {
    score,
    percentage,
    keywords: matched.map((keyword) => keyword.label)
  };
}

function scoreRules(text, rules) {
  return rules
    .map((rule) => ({
      ...rule,
      matchedTerms: rule.terms.filter((term) => textIncludesTerm(text, term))
    }))
    .filter((rule) => rule.matchedTerms.length > 0);
}

function normalizeNoMatchKeywords(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(/[\n,]/);

  return list
    .map((term) => String(term || "").trim())
    .filter(Boolean)
    .slice(0, 50);
}

function excludePreferredSectionText(text) {
  return splitRequirementSections(text)
    .filter((section) => section.type !== "preferred")
    .map((section) => section.text)
    .join("\n");
}

function analyzeLocalMatch(text, noMatchKeywords = []) {
  const resumeMatch = analyzeResumeMatch(text);
  const domainMismatches = scoreRules(text, DOMAIN_MISMATCH_RULES);
  const senioritySignals = scoreRules(text, SENIORITY_RULES);
  const overrideTerms = MISMATCH_OVERRIDES.filter((term) => textIncludesTerm(text, term));
  // A no-match keyword mentioned only under "Preferred Qualifications" is a nice-to-have, not a
  // reason to hard-skip -- only count it if it also appears somewhere outside that section
  // (Minimum Qualifications, Responsibilities, or unstructured postings with no section headers).
  const noMatchScanText = excludePreferredSectionText(text);
  const noMatchKeywordHits = noMatchKeywords.filter((term) => term && textIncludesTerm(noMatchScanText, term));
  const mismatchPenalty = domainMismatches.reduce((total, rule) => total + rule.penalty, 0);
  const seniorityPenalty = senioritySignals.reduce((total, rule) => total + rule.penalty, 0);
  const overrideCredit = overrideTerms.length ? Math.min(8, overrideTerms.length * 2) : 0;
  const score = resumeMatch.score - mismatchPenalty - seniorityPenalty + overrideCredit;

  return {
    score,
    percentage: Math.max(0, Math.min(100, Math.round((score / 30) * 100))),
    positiveScore: resumeMatch.score,
    mismatchPenalty,
    seniorityPenalty,
    overrideCredit,
    keywords: resumeMatch.keywords,
    domainMismatches: domainMismatches.map((rule) => rule.label),
    senioritySignals: senioritySignals.map((rule) => rule.label),
    overrideTerms,
    noMatchKeywordHits,
    reasons: [
      ...resumeMatch.keywords.map((keyword) => `Matched resume skill: ${keyword}`),
      ...domainMismatches.map((rule) => `Domain mismatch: ${rule.label}`),
      ...senioritySignals.map((rule) => `Seniority signal: ${rule.label}`),
      ...overrideTerms.map((term) => `Relevant domain override: ${term}`),
      ...noMatchKeywordHits.map((term) => `No-match keyword: ${term}`)
    ]
  };
}

function hasHardSeniorityMismatch(title) {
  return /\b(senior|staff|principal|lead|manager)\b|\bsr\.?(?=\s|$|[-,()/])/i.test(title);
}

function isInternshipTitle(title) {
  return /\bintern(s|ships?)?\b/i.test(title);
}

function hasBackendOrFullStackFit(matchScore) {
  return matchScore.keywords.some((keyword) =>
    [
      "Backend/API Engineering",
      "Full Stack Engineering",
      "Event/Queue Systems",
      "Cloud Infrastructure",
      "C#/.NET",
      "Angular",
      "AWS",
      "DynamoDB",
      "Terraform",
      "Microservices",
      "SQL/Databases"
    ].includes(keyword)
  );
}

function normalizeUserYearsOfExperience(value) {
  const years = Number(value);

  if (!Number.isFinite(years) || years < 0) {
    return DEFAULT_USER_YOE;
  }

  return Math.min(50, years);
}

function classifyRole(matches, matchScore, title, userYearsOfExperience = DEFAULT_USER_YOE) {
  const maxAcceptableRequiredYears = normalizeUserYearsOfExperience(userYearsOfExperience);
  const maxRequiredYears = getMaxYears(matches, (match) => match.type === "required");
  const maxMentionedYears = getMaxYears(matches);
  const maxNonPreferredYears = getMaxYears(matches, (match) => match.type !== "preferred");

  if (matchScore.noMatchKeywordHits?.length) {
    return {
      decision: "Likely skip",
      requiredYears: maxRequiredYears,
      reason: `Matched your no-match keyword list: ${matchScore.noMatchKeywordHits.join(", ")}.`
    };
  }

  if (hasHardSeniorityMismatch(title)) {
    return {
      decision: "Likely skip",
      requiredYears: maxRequiredYears,
      reason: `Title appears senior-level: ${title}.`
    };
  }

  if (isInternshipTitle(title)) {
    return {
      decision: "Likely skip",
      requiredYears: maxRequiredYears,
      reason: `Title appears to be an internship: ${title}.`
    };
  }

  if (maxRequiredYears !== null && maxRequiredYears > maxAcceptableRequiredYears) {
    return {
      decision: "Likely skip",
      requiredYears: maxRequiredYears,
      reason: `A required experience sentence appears to exceed your ${maxAcceptableRequiredYears} years of experience.`
    };
  }

  if (
    maxNonPreferredYears !== null &&
    maxNonPreferredYears >= Math.max(HIGH_YOE_HARD_SKIP_FLOOR, maxAcceptableRequiredYears + HIGH_YOE_HARD_SKIP_BUFFER) &&
    maxNonPreferredYears > maxAcceptableRequiredYears
  ) {
    return {
      decision: "Likely skip",
      requiredYears: maxNonPreferredYears,
      reason: `A high years-of-experience signal (${maxNonPreferredYears}+ years) appears to exceed your ${maxAcceptableRequiredYears} years of experience.`
    };
  }

  if (matchScore.mismatchPenalty >= 16 && matchScore.overrideCredit < 4) {
    return {
      decision: "Likely skip",
      requiredYears: maxRequiredYears,
      reason: `Strong domain mismatch detected: ${matchScore.domainMismatches.join(", ")}.`
    };
  }

  if (matchScore.seniorityPenalty >= 10 && matchScore.score < 14 && !hasBackendOrFullStackFit(matchScore)) {
    return {
      decision: "Likely skip",
      requiredYears: maxRequiredYears,
      reason: `Seniority mismatch detected: ${matchScore.senioritySignals.join(", ")}.`
    };
  }

  // By this point maxRequiredYears is either absent or already within budget (the hard-skip
  // checks above would have returned otherwise), so a missing YOE requirement is treated the
  // same as a satisfied one rather than as a reason for lower confidence.
  if (matchScore.score >= 8) {
    return {
      decision: "Likely match",
      requiredYears: maxRequiredYears,
      reason:
        maxRequiredYears !== null
          ? `Required experience is acceptable and local fit score is strong (${matchScore.percentage}%).`
          : `No years-of-experience requirement was stated (treated as met) and local fit score is strong (${matchScore.percentage}%).`
    };
  }

  if (matchScore.score >= 4) {
    return {
      decision: "Review",
      requiredYears: null,
      reason:
        maxRequiredYears !== null || (maxMentionedYears !== null && maxMentionedYears <= maxAcceptableRequiredYears)
          ? `Experience looks acceptable, but local fit score is moderate (${matchScore.percentage}%).`
          : `No years-of-experience requirement was stated (treated as met), but local fit score is only moderate (${matchScore.percentage}%).`
    };
  }

  return {
    decision: "Unknown",
    requiredYears: null,
    reason: "No clear years-of-experience requirement or strong resume keyword match was detected."
  };
}

function getSubmittedSignal() {
  const candidates = document.querySelectorAll("button, [role='button'], a, [aria-label], span, div");

  for (const candidate of candidates) {
    if (!isElementVisible(candidate)) {
      continue;
    }

    const rect = candidate.getBoundingClientRect();
    if (rect.top > 700) {
      continue;
    }

    const label = normalizeText(`${candidate.innerText || ""} ${candidate.getAttribute("aria-label") || ""}`);
    const lower = label.toLowerCase();

    if (!label || label.length > 120) {
      continue;
    }

    if (
      /^(submitted|application submitted|resume submitted)$/.test(lower) ||
      /\b(application|resume)?\s*submitted\b/.test(lower)
    ) {
      return {
        text: label,
        tagName: candidate.tagName.toLowerCase()
      };
    }
  }

  return null;
}

function isAlreadyAppliedDialogText(text) {
  const lower = normalizeText(text || "").toLowerCase();

  return (
    /\b(application failed|unable to apply|already applied)\b/.test(lower) &&
    /\b(already applied|unable to apply again|apply again)\b/.test(lower)
  );
}

function getAlreadyAppliedDialog() {
  const dialogs = Array.from(
    document.querySelectorAll("[role='dialog'], .uddialogwrap, .uddialogcontent, .udconfirm")
  ).filter((element) => isElementVisible(element));

  for (const dialog of dialogs) {
    const text = normalizeText(dialog.innerText || "");

    if (isAlreadyAppliedDialogText(text)) {
      return {
        element: dialog,
        text: text.slice(0, 240),
        title: normalizeText(dialog.querySelector(".udconfirmtitleContent, [class*='confirmtitle']")?.innerText || ""),
        body: normalizeText(dialog.querySelector(".udconfirmbody, [class*='confirmbody']")?.innerText || "")
      };
    }
  }

  return null;
}

// ByteDance's "already applied through another channel" message renders as a self-dismissing
// toast/notice (atsx-message-*), not a modal dialog, so getAlreadyAppliedDialog()'s dialog-only
// selectors never match it.
function getAlreadyAppliedToast() {
  const toasts = Array.from(
    document.querySelectorAll(
      ".atsx-message-notice, .atsx-message-custom-content, [class*='message-notice'], [class*='message-custom-content']"
    )
  ).filter((element) => isElementVisible(element));

  for (const toast of toasts) {
    const text = normalizeText(toast.innerText || "");

    if (isAlreadyAppliedDialogText(text)) {
      return {
        element: toast,
        text: text.slice(0, 240)
      };
    }
  }

  return null;
}

function getAlreadyAppliedSignal() {
  return getAlreadyAppliedDialog() || getAlreadyAppliedToast();
}

// The above toast is only visible for a few seconds and can take several more to appear after the
// click (server round-trip for the duplicate-application check), so a single check after one fixed
// delay can land before it appears or after it's already gone. Poll instead so a signal appearing
// anywhere in that window gets caught.
async function waitForSubmissionOutcome(options = {}) {
  const timeoutMs = options.timeoutMs ?? 9000;
  const intervalMs = options.intervalMs ?? 400;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const submittedSignal = getSubmittedSignal();
    if (submittedSignal) {
      return { type: "submitted", signal: submittedSignal };
    }

    const alreadyAppliedSignal = getAlreadyAppliedSignal();
    if (alreadyAppliedSignal) {
      return { type: "already_applied", signal: alreadyAppliedSignal };
    }

    await delay(intervalMs);
  }

  return null;
}

function extractJobDetails(options = {}) {
  const text = getVisiblePageText();
  const matches = extractExperienceMatches(text);
  const noMatchKeywords = normalizeNoMatchKeywords(options.noMatchKeywords);
  const matchScore = analyzeLocalMatch(text, noMatchKeywords);
  const title = getJobTitle();
  const userYearsOfExperience = normalizeUserYearsOfExperience(options.userYearsOfExperience);
  const classification = classifyRole(matches, matchScore, title, userYearsOfExperience);
  const submittedSignal = getSubmittedSignal();

  return {
    site: getSiteId(),
    siteLabel: getSiteLabel(),
    url: window.location.href,
    title,
    jobId: getJobId(),
    userYearsOfExperience,
    alreadySubmitted: Boolean(submittedSignal),
    submittedSignal,
    resumeMatch: {
      score: matchScore.positiveScore,
      percentage: Math.min(100, Math.round((matchScore.positiveScore / 30) * 100)),
      keywords: matchScore.keywords
    },
    matchScore,
    jobText: text.slice(0, 12000),
    preview: extractRequirementPreview(text),
    matches,
    ...classification
  };
}

function collectJobLinks() {
  const linksByUrl = new Map();
  const siteConfig = getSiteConfig();

  for (const anchor of document.querySelectorAll("a[href]")) {
    if (!isElementVisible(anchor)) {
      continue;
    }

    const url = new URL(anchor.href, window.location.href);
    const isSupportedJobDetail = siteConfig?.isSupportedUrl(url) && siteConfig?.isJobDetailUrl(url);

    if (!isSupportedJobDetail || linksByUrl.has(url.href)) {
      continue;
    }

    const jobId = getJobIdFromUrl(url.href);

    linksByUrl.set(url.href, {
      site: siteConfig.id,
      siteLabel: siteConfig.label,
      url: url.href,
      jobId,
      title: cleanTitle(anchor.innerText || anchor.getAttribute("aria-label") || "Untitled job"),
      alreadyAppliedFromList: hasAppliedSignalInListRow(anchor, jobId)
    });
  }

  return Array.from(linksByUrl.values());
}

// Client-rendered list pages (e.g. joinbytedance.com's SPA) can still be lazy-loading job cards
// when a collection request arrives right after the tab was opened or a scan was just started --
// there's no navigation/load event to wait on for that, unlike a fresh tab. Poll until the visible
// job link count stops changing (or a timeout elapses) before treating a collection as final, so
// the first page of a scan and the current page's true job count aren't read mid-render.
async function waitForJobListToSettle(options = {}) {
  const timeoutMs = options.timeoutMs ?? 4500;
  const intervalMs = options.intervalMs ?? 200;
  const stableChecksRequired = options.stableChecksRequired ?? 4;
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableCount = 0;

  while (Date.now() < deadline) {
    const currentCount = collectJobLinks().length;

    if (currentCount > 0 && currentCount === lastCount) {
      stableCount += 1;
      if (stableCount >= stableChecksRequired) {
        return;
      }
    } else {
      stableCount = 0;
    }

    lastCount = currentCount;
    await delay(intervalMs);
  }
}

function getJobListStats(links) {
  const applied = links.filter((link) => link.alreadyAppliedFromList).length;

  return {
    total: links.length,
    applied,
    unapplied: links.length - applied
  };
}

function getJobScopedElements(jobId) {
  if (!jobId) {
    return [];
  }

  return Array.from(document.querySelectorAll("[id], [aria-describedby], img[src]")).filter((element) => {
    const marker = `${element.getAttribute("id") || ""} ${element.getAttribute("aria-describedby") || ""} ${
      element.getAttribute("src") || ""
    }`;
    return marker.includes(jobId);
  });
}

function getSubmitControlState(control) {
  if (!control) {
    return "unknown";
  }

  const label = normalizeText(
    `${control.textContent || ""} ${control.getAttribute("aria-label") || ""} ${
      control.getAttribute("title") || ""
    } ${control.getAttribute("id") || ""} ${control.getAttribute("class") || ""}`
  ).toLowerCase();
  const isDisabled = control.getAttribute("aria-disabled") === "true";

  if (/\b(submitted|applied)\b/.test(label) || (isDisabled && /\bdisable-role-submit-button\b/.test(label))) {
    return "applied";
  }

  if (/\bsubmit resume\b/.test(label) || control.getAttribute("aria-disabled") === "false") {
    return "unapplied";
  }

  return "unknown";
}

function getJobListRow(anchor) {
  const semanticRow = anchor.closest("li, article, [role='listitem'], tr, [data-job-id]");
  if (semanticRow) {
    return semanticRow;
  }

  let current = anchor.parentElement;
  for (let depth = 0; current && depth < 8; depth += 1) {
    if (
      current.querySelector(
        "[id*='applied-role-icon'], [id*='submit-role'], [class*='submit-role'], img[src*='checkmark-green']"
      )
    ) {
      return current;
    }
    current = current.parentElement;
  }

  return anchor.parentElement;
}

function hasAppliedSignalInListRow(anchor, jobId) {
  const jobScopedElements = getJobScopedElements(jobId);
  const jobScopedSubmitControl = jobScopedElements.find((element) =>
    `${element.getAttribute("id") || ""} ${element.getAttribute("class") || ""}`.includes("submit-role")
  );
  const jobScopedSubmitState = getSubmitControlState(jobScopedSubmitControl);
  const jobScopedMarker = normalizeText(
    jobScopedElements
      .map(
        (element) =>
          `${element.getAttribute("id") || ""} ${element.getAttribute("aria-describedby") || ""} ${
            element.getAttribute("src") || ""
          } ${element.getAttribute("class") || ""}`
      )
      .join(" ")
  ).toLowerCase();

  if (/\b(applied-role-icon|circle-checkmark-green|checkmark-green)\b/.test(jobScopedMarker)) {
    return true;
  }

  if (jobScopedSubmitState === "applied") {
    return true;
  }

  if (jobScopedSubmitState === "unapplied") {
    return false;
  }

  const row = getJobListRow(anchor);

  if (!row || !isElementVisible(row)) {
    return false;
  }

  const submitControl = row.querySelector(
    [
      "[id*='submit-role']",
      "[class*='submit-role']",
      "[aria-describedby*='submit-role']",
      "a[role='link'][id*='submit-role']",
      "button[id*='submit-role']"
    ].join(", ")
  );

  const appliedIcon = row.querySelector(
    [
      "[id*='applied-role-icon']",
      "[aria-describedby*='applied-role-icon']",
      "img[id*='applied-role-icon']",
      "img[src*='circle-checkmark-green']",
      "img[src*='checkmark-green']"
    ].join(", ")
  );

  if (appliedIcon) {
    return true;
  }

  const submitState = getSubmitControlState(submitControl);
  if (submitState === "applied") {
    return true;
  }

  if (submitState === "unapplied") {
    return false;
  }

  const text = normalizeText(row.innerText || "").toLowerCase();
  if (/\b(submitted|applied|application submitted|resume submitted)\b/.test(text)) {
    return true;
  }

  const expandedText = normalizeText(row.textContent || "").toLowerCase();
  if (/\b(submitted|applied|application submitted|resume submitted)\b/.test(expandedText)) {
    return true;
  }

  const statusCandidates = row.querySelectorAll("[aria-label], [title], svg, use, path, span, img, button, a");
  for (const candidate of statusCandidates) {
    const label = normalizeText(
      `${candidate.getAttribute("aria-label") || ""} ${candidate.getAttribute("title") || ""} ${
        candidate.getAttribute("id") || ""
      } ${candidate.getAttribute("src") || ""} ${
        candidate.getAttribute("class") || ""
      }`
    ).toLowerCase();

    if (/\b(submit-role|disable-role-submit-button)\b/.test(label)) {
      return false;
    }

    if (/\b(submitted|applied|applied-role-icon|circle-checkmark-green|checkmark-green)\b/.test(label)) {
      return true;
    }
  }

  return false;
}

function getCurrentResultsPage() {
  const url = new URL(window.location.href);
  const pageParams = ["page", "pg", "p"];

  for (const param of pageParams) {
    const value = Number(url.searchParams.get(param));
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }

  const offset = Number(url.searchParams.get("offset") || url.searchParams.get("start"));
  const pageSize = Number(url.searchParams.get("limit") || url.searchParams.get("size") || 20);
  if (Number.isInteger(offset) && offset >= 0 && Number.isInteger(pageSize) && pageSize > 0) {
    return Math.floor(offset / pageSize) + 1;
  }

  const currentPageControl = Array.from(
    document.querySelectorAll("[aria-current='page'], [aria-selected='true'], .active, button, a")
  )
    .filter((element) => isElementVisible(element))
    .map((element) => normalizeText(element.innerText || element.getAttribute("aria-label") || ""))
    .map((label) => label.match(/\b(\d{1,4})\b/)?.[1])
    .map(Number)
    .find((value) => Number.isInteger(value) && value > 0);

  return currentPageControl || 1;
}

function getNextPageControl() {
  const siteConfig = getSiteConfig();

  if (siteConfig?.id === "tiktok" && getTikTokNextPageButton()) {
    return {
      action: "click",
      source: "tiktok_pagination"
    };
  }

  const candidates = document.querySelectorAll("a[href], button, [role='button']");

  for (const candidate of candidates) {
    if (!isElementVisible(candidate)) {
      continue;
    }

    const label = normalizeText(`${candidate.innerText || ""} ${candidate.getAttribute("aria-label") || ""}`);
    const lower = label.toLowerCase();
    const isNext = /^(next|next page)$/.test(lower) || /\bnext page\b/.test(lower);
    const isDisabled =
      candidate.disabled ||
      candidate.getAttribute("aria-disabled") === "true" ||
      candidate.getAttribute("disabled") !== null;

    if (!isNext || isDisabled) {
      continue;
    }

    if (candidate instanceof HTMLAnchorElement && candidate.href) {
      return {
        action: "navigate",
        url: candidate.href
      };
    }

    return {
      action: "click"
    };
  }

  return null;
}

// Not every ByteDance-family site tags its pagination bar with [data-testid='pagination'] (e.g.
// joinbytedance.com doesn't). Fall back to finding it structurally: a numbered pagination widget
// is a set of sibling <button>s where several have plain digit text (page numbers) sharing a
// common parent -- that parent is the pagination container, whether or not it's tagged.
function getGenericNumberedPaginationContainer() {
  const numberButtons = Array.from(document.querySelectorAll("button"))
    .filter((button) => isElementVisible(button))
    .filter((button) => /^\d+$/.test(normalizeText(button.textContent || "")));

  const parentCounts = new Map();
  for (const button of numberButtons) {
    const parent = button.parentElement;
    if (!parent) {
      continue;
    }
    parentCounts.set(parent, (parentCounts.get(parent) || 0) + 1);
  }

  const bestParent = Array.from(parentCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0];

  return bestParent || null;
}

function getTikTokPaginationContainer() {
  const taggedContainer = document.querySelector("[data-testid='pagination']");
  if (taggedContainer && isElementVisible(taggedContainer)) {
    return taggedContainer;
  }

  return getGenericNumberedPaginationContainer();
}

function getTikTokNextPageButton() {
  const pagination = getTikTokPaginationContainer();
  if (!pagination) {
    return null;
  }

  const arrowButtons = Array.from(pagination.querySelectorAll("button"))
    .filter((button) => isElementVisible(button))
    .filter((button) => button.querySelector("svg"))
    .filter((button) => {
      const label = normalizeText(
        `${button.innerText || ""} ${button.textContent || ""} ${button.getAttribute("aria-label") || ""}`
      );
      return !/\d+|\.\.\./.test(label);
    });

  for (const button of arrowButtons.toReversed()) {
    const classes = button.getAttribute("class") || "";
    const isDisabled =
      button.disabled ||
      button.getAttribute("aria-disabled") === "true" ||
      button.getAttribute("disabled") !== null ||
      /\b(cursor-not-allowed|pointer-events-none)\b/.test(classes);

    if (!isDisabled) {
      return button;
    }
  }

  return null;
}

function getJobLinkSetKey(links) {
  return links
    .map((link) => link.url)
    .sort()
    .join("|");
}

// Sites like TikTok paginate client-side (the "Next" control is a button, not a link -- see
// getNextPageControl()'s action: "click" path) without changing the URL or firing a navigation
// event, so there is nothing for waitForTabComplete() to hook into. A fixed delay after the click
// races the SPA's re-render: if it loses, the next collectJobLinks() call still sees the old page's
// (already-processed) links, which the scan loop reads as "nothing new on a page I've already
// visited" and stops the whole scan early, believing the list is exhausted. Poll for the visible
// job link set to actually change instead of guessing a delay.
async function waitForJobLinksChange(previousLinks, options = {}) {
  const timeoutMs = options.timeoutMs ?? 12000;
  const intervalMs = options.intervalMs ?? 500;
  const previousKey = getJobLinkSetKey(previousLinks);
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    await delay(intervalMs);
    const currentLinks = collectJobLinks();

    if (currentLinks.length > 0 && getJobLinkSetKey(currentLinks) !== previousKey) {
      return true;
    }
  }

  return false;
}

async function goToNextPage() {
  const nextPageControl = getNextPageControl();

  if (!nextPageControl) {
    return {
      ok: false,
      reason: "No enabled next-page control was found."
    };
  }

  if (nextPageControl.action === "navigate") {
    window.location.href = nextPageControl.url;
    return {
      ok: true,
      action: "navigate",
      url: nextPageControl.url
    };
  }

  const previousLinks = collectJobLinks();

  if (nextPageControl.source === "tiktok_pagination") {
    const nextButton = getTikTokNextPageButton();
    if (nextButton) {
      nextButton.click();
      const changed = await waitForJobLinksChange(previousLinks);
      return changed
        ? { ok: true, action: "click", source: "tiktok_pagination" }
        : { ok: false, reason: "The job list did not visibly change after clicking the next-page control." };
    }
  }

  const candidates = document.querySelectorAll("a[href], button, [role='button']");
  for (const candidate of candidates) {
    const label = normalizeText(`${candidate.innerText || ""} ${candidate.getAttribute("aria-label") || ""}`);
    const lower = label.toLowerCase();

    if ((/^(next|next page)$/.test(lower) || /\bnext page\b/.test(lower)) && isElementVisible(candidate)) {
      candidate.click();
      const changed = await waitForJobLinksChange(previousLinks);
      return changed
        ? { ok: true, action: "click" }
        : { ok: false, reason: "The job list did not visibly change after clicking the next-page control." };
    }
  }

  return {
    ok: false,
    reason: "Next-page control disappeared before it could be clicked."
  };
}

function getElementLabel(element) {
  const labels = [];

  if (element.labels?.length) {
    labels.push(...Array.from(element.labels).map((label) => label.innerText));
  }

  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) {
    labels.push(ariaLabel);
  }

  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    for (const id of labelledBy.split(/\s+/)) {
      const labelElement = document.getElementById(id);
      if (labelElement) {
        labels.push(labelElement.innerText);
      }
    }
  }

  const placeholder = element.getAttribute("placeholder");
  if (placeholder) {
    labels.push(placeholder);
  }

  const nearbyText = element.closest("label, fieldset, div, li, section")?.innerText;
  if (nearbyText) {
    labels.push(nearbyText.split("\n").slice(0, 3).join(" "));
  }

  return normalizeText(labels.find(Boolean) || element.name || element.id || "Unlabeled field");
}

function getFieldKind(element) {
  const tagName = element.tagName.toLowerCase();

  if (tagName === "select") {
    return "select";
  }

  if (tagName === "textarea") {
    return "textarea";
  }

  if (element.isContentEditable) {
    return "rich_text";
  }

  return element.getAttribute("type") || "text";
}

function inferFieldCategory(label, kind) {
  const lower = `${label} ${kind}`.toLowerCase();

  if (/\b(first name|last name|full name|legal name|preferred name)\b/.test(lower)) {
    return "name";
  }

  if (/\b(email|e-mail)\b/.test(lower)) {
    return "email";
  }

  if (/\b(phone|mobile|telephone)\b/.test(lower)) {
    return "phone";
  }

  if (/\b(resume|cv|curriculum vitae|upload|attachment)\b/.test(lower) || kind === "file") {
    return "resume_or_file";
  }

  if (/\b(education|school|university|degree|major|gpa)\b/.test(lower)) {
    return "education";
  }

  if (/\b(experience|employer|company|job title|work history)\b/.test(lower)) {
    return "experience";
  }

  if (/\b(work authorization|authorized|visa|sponsor|sponsorship|citizen)\b/.test(lower)) {
    return "work_authorization";
  }

  if (/\b(gender|race|ethnicity|veteran|disability|voluntary|demographic)\b/.test(lower)) {
    return "voluntary_disclosure";
  }

  if (/\b(address|city|state|province|zip|postal|country)\b/.test(lower)) {
    return "location";
  }

  return "unknown";
}

function isRequiredField(element, label) {
  const lower = label.toLowerCase();

  return (
    element.required ||
    element.getAttribute("aria-required") === "true" ||
    /\brequired\b|\*/.test(lower)
  );
}

function getOptionPreview(element) {
  if (!(element instanceof HTMLSelectElement)) {
    return [];
  }

  return Array.from(element.options)
    .map((option) => normalizeText(option.textContent || option.value))
    .filter(Boolean)
    .slice(0, 6);
}

function analyzeApplicationPage() {
  const fields = Array.from(
    document.querySelectorAll("input, select, textarea, [contenteditable='true']")
  )
    .filter((element) => isElementVisible(element))
    .filter((element) => !["hidden", "submit", "button", "reset"].includes(getFieldKind(element)))
    .map((element, index) => {
      const label = getElementLabel(element);
      const kind = getFieldKind(element);

      return {
        index: index + 1,
        label,
        kind,
        category: inferFieldCategory(label, kind),
        required: isRequiredField(element, label),
        name: element.name || null,
        id: element.id || null,
        options: getOptionPreview(element)
      };
    });

  const buttons = Array.from(document.querySelectorAll("button, input[type='submit'], [role='button']"))
    .filter((element) => isElementVisible(element))
    .map((element) => normalizeText(element.innerText || element.value || element.getAttribute("aria-label") || ""))
    .filter(Boolean)
    .slice(0, 12);

  const requiredCount = fields.filter((field) => field.required).length;
  const unsupportedFields = fields.filter((field) =>
    ["file", "rich_text"].includes(field.kind) || field.category === "unknown"
  );

  return {
    url: window.location.href,
    title: document.title,
    heading: normalizeText(document.querySelector("h1, h2")?.innerText || ""),
    formCount: document.querySelectorAll("form").length,
    fieldCount: fields.length,
    requiredCount,
    unsupportedCount: unsupportedFields.length,
    fields: fields.slice(0, 40),
    buttons,
    summary:
      fields.length === 0
        ? "No visible application fields were detected on this page."
        : `Detected ${fields.length} visible fields, including ${requiredCount} required fields.`
  };
}

function delay(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isActionDisabled(element) {
  return (
    element.disabled ||
    element.getAttribute("aria-disabled") === "true" ||
    element.getAttribute("disabled") !== null
  );
}

function getActionLabel(element) {
  return normalizeText(element.innerText || element.value || element.getAttribute("aria-label") || "");
}

function getClickableCandidates() {
  return Array.from(document.querySelectorAll("button, input[type='button'], input[type='submit'], a, [role='button']"))
    .filter((element) => isElementVisible(element))
    .filter((element) => !isActionDisabled(element));
}

function getVisibleActionLabels() {
  return getClickableCandidates()
    .map(getActionLabel)
    .filter(Boolean)
    .slice(0, 12);
}

function getSessionRequiredSignal() {
  const url = getCurrentUrl();
  const heading = normalizeText(document.querySelector("h1, h2")?.innerText || "");
  const bodyText = getVisiblePageText().slice(0, 5000);

  if (/\/(?:login|sign-?in|auth|authenticate)(?:\/|$)/i.test(url.pathname)) {
    return heading || "Login page";
  }

  if (/\b(session expired|authentication required|access denied|please sign in to continue|please log in to continue)\b/i.test(bodyText)) {
    return RegExp.lastMatch || "Login or session action required";
  }

  if (/^(sign in|sign-in|log in|login|authenticate)$/i.test(heading)) {
    return heading;
  }

  return null;
}

function findClickableByText(pattern) {
  return getClickableCandidates().find((element) => pattern.test(getActionLabel(element)));
}

function findJobSpecificApplyAction(siteConfig, jobId) {
  if (siteConfig?.id !== "tiktok") {
    return findClickableByText(siteConfig?.applyPattern || /^submit resume$/i);
  }

  const jobApplySelectors = [
    `a[href*="/resume/${jobId}/apply"]`,
    `button[data-tracking="job-apply-button"][tracking-value="${jobId}"]`,
    `button[tracking-value="${jobId}"]`,
    'button[data-tracking="job-apply-button"]'
  ];

  for (const selector of jobApplySelectors) {
    const candidate = document.querySelector(selector);

    if (candidate && isElementVisible(candidate) && !isActionDisabled(candidate)) {
      return candidate;
    }

    const nestedButton = candidate?.querySelector?.("button, [role='button']");
    if (nestedButton && isElementVisible(nestedButton) && !isActionDisabled(nestedButton)) {
      return nestedButton;
    }
  }

  return getClickableCandidates().find((element) => /^apply to this job$/i.test(getActionLabel(element)));
}

async function waitForJobSpecificApplyAction(siteConfig, jobId, timeoutMs = 6000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const element = findJobSpecificApplyAction(siteConfig, jobId);

    if (element) {
      return element;
    }

    await delay(300);
  }

  return null;
}

function getLoadingSignal() {
  const candidates = Array.from(
    document.querySelectorAll("[aria-busy='true'], [role='progressbar'], [aria-label], button, div, span")
  );

  for (const candidate of candidates) {
    if (!isElementVisible(candidate)) {
      continue;
    }

    const label = normalizeText(
      `${candidate.innerText || ""} ${candidate.getAttribute("aria-label") || ""} ${candidate.getAttribute("title") || ""}`
    );

    if (/\b(loading|please wait|submitting|processing|in progress)\b/i.test(label)) {
      return label || "Loading";
    }
  }

  return null;
}

async function waitForClickable(pattern, timeoutMs = WORKFLOW_WAIT_TIMEOUT_MS) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const element = findClickableByText(pattern);

    if (element) {
      return element;
    }

    await delay(300);
  }

  return null;
}

async function clickAction(pattern, stepName, steps, options = {}) {
  if (options.scrollBottom) {
    window.scrollTo(0, document.body.scrollHeight);
    await delay(500);
  }

  const element = await waitForClickable(pattern, options.timeoutMs);

  if (!element) {
    steps.push({
      step: stepName,
      status: "missing"
    });
    return false;
  }

  element.scrollIntoView({
    block: "center"
  });
  await delay(200);
  element.click();
  steps.push({
    step: stepName,
    status: "clicked",
    label: getActionLabel(element)
  });
  await delay(options.afterClickDelayMs || WORKFLOW_STEP_DELAY_MS);

  return true;
}

async function clickAndDetectSubmission(element, steps) {
  element.scrollIntoView({
    block: "center"
  });
  await delay(200);
  element.click();
  steps.push({
    step: "Submit application",
    status: "clicked",
    label: getActionLabel(element)
  });

  const outcome = await waitForSubmissionOutcome();

  if (outcome?.type === "submitted") {
    steps.push({
      step: "Confirm application submitted",
      status: "detected",
      label: outcome.signal.text
    });
    return {
      clicked: true,
      done: true,
      pending: false,
      summary: "Clicked final Submit and detected Submitted confirmation."
    };
  }

  if (outcome?.type === "already_applied") {
    const alreadyAppliedSignal = outcome.signal;
    steps.push({
      step: "Detect already applied dialog",
      status: "detected",
      label: alreadyAppliedSignal.body || alreadyAppliedSignal.text
    });
    return {
      clicked: true,
      done: true,
      pending: false,
      alreadySubmitted: true,
      errorType: "already_applied",
      summary: alreadyAppliedSignal.body || alreadyAppliedSignal.text || "You've already applied for this job. Unable to apply again."
    };
  }

  const loadingSignal = getLoadingSignal();
  if (loadingSignal) {
    steps.push({
      step: "Wait for submit result",
      status: "loading",
      label: loadingSignal
    });
    return {
      clicked: true,
      done: false,
      pending: true,
      summary: "Clicked final Submit, but the page is still loading."
    };
  }

  return {
    clicked: true,
    done: true,
    pending: false,
    summary: "Clicked final Submit."
  };
}

async function clickFinalSubmit(steps) {
  window.scrollTo(0, document.body.scrollHeight);
  await delay(500);

  const siteConfig = getSiteConfig();
  const element = await waitForClickable(siteConfig?.finalSubmitPattern || /^submit$/i, 4000);

  if (!element) {
    steps.push({
      step: "Submit application",
      status: "missing"
    });
    return {
      clicked: false,
      done: false,
      pending: false,
      summary: "Final Submit was not found."
    };
  }

  return clickAndDetectSubmission(element, steps);
}

function findPrimaryActionButton(siteConfig) {
  if (!siteConfig?.primaryActionId) {
    return null;
  }

  const element = document.getElementById(siteConfig.primaryActionId);

  if (!element || !isElementVisible(element) || isActionDisabled(element)) {
    return null;
  }

  return element;
}

// Apple reuses the exact same button (and id) for both "Continue" and the final "Submit" across
// every step of the apply flow, only changing its visible text. Targeting it by id is more
// reliable and faster than the text-pattern searches below, which are kept as a fallback for
// sites/pages where this id isn't present.
async function clickPrimaryAction(siteConfig, steps) {
  const primaryButton = findPrimaryActionButton(siteConfig);

  if (!primaryButton) {
    const submitResult = await clickFinalSubmit(steps);

    if (submitResult.done || submitResult.pending) {
      return submitResult;
    }

    const continued = await clickAction(
      siteConfig?.continuePattern || /^continue$/i,
      "Continue application step",
      steps,
      { scrollBottom: true, timeoutMs: 5000 }
    );

    return {
      clicked: continued,
      done: false,
      pending: false,
      summary: continued ? "Clicked Continue." : "No Continue or Submit action was found on this application step."
    };
  }

  const label = getActionLabel(primaryButton);
  const isFinalSubmit = (siteConfig?.finalSubmitPattern || /^submit$/i).test(label);

  window.scrollTo(0, document.body.scrollHeight);
  await delay(500);

  if (isFinalSubmit) {
    return clickAndDetectSubmission(primaryButton, steps);
  }

  primaryButton.scrollIntoView({
    block: "center"
  });
  await delay(200);
  primaryButton.click();
  steps.push({
    step: "Continue application step",
    status: "clicked",
    label
  });
  await delay(WORKFLOW_STEP_DELAY_MS);

  return {
    clicked: true,
    done: false,
    pending: false,
    summary: "Clicked Continue."
  };
}

function findSponsorshipContainer() {
  const containers = Array.from(document.querySelectorAll("fieldset, section, div, li"))
    .filter((element) => isElementVisible(element))
    .filter((element) => {
      const text = normalizeText(element.innerText || "").toLowerCase();
      return /\b(visa|sponsor|sponsorship|work authorization)\b/.test(text);
    })
    .sort((a, b) => normalizeText(a.innerText || "").length - normalizeText(b.innerText || "").length);

  return containers[0] || null;
}

function clickSponsorshipAnswer(steps) {
  const container = findSponsorshipContainer();

  if (!container) {
    return false;
  }

  const candidates = Array.from(
    container.querySelectorAll("label, button, [role='radio'], [role='button'], input[type='radio']")
  ).filter((element) => isElementVisible(element));

  for (const candidate of candidates) {
    const label = getActionLabel(candidate) || getElementLabel(candidate);
    const value = candidate.value || "";
    const lower = `${label} ${value}`.toLowerCase();
    const isYes = /\byes\b/.test(lower) && !/\bno\b/.test(lower);

    if (!isYes || isActionDisabled(candidate)) {
      continue;
    }

    candidate.scrollIntoView({
      block: "center"
    });
    candidate.click();
    steps.push({
      step: "Answer visa sponsorship",
      status: "clicked",
      label: "Yes"
    });
    return true;
  }

  steps.push({
    step: "Answer visa sponsorship",
    status: "missing"
  });
  return false;
}

function isYesAnswerText(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return /\byes\b/.test(lower) && !/\bno\b/.test(lower);
}

function isNoAnswerText(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return /\bno\b/.test(lower) && !/\byes\b/.test(lower);
}

function isWorkAuthorizationQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return (
    /\blegally authorized\b/.test(lower) ||
    /\bauthorized to work\b/.test(lower) ||
    /\bwork in the (?:us|u\.s\.|united states)\b/.test(lower)
  );
}

function isVisaSponsorshipQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return (
    /\bvisa sponsorship\b/.test(lower) ||
    /\brequire sponsorship\b/.test(lower) ||
    /\bsponsorship for employment\b/.test(lower) ||
    /\bvisa transfer\b/.test(lower) ||
    /\bnow or in the future\b.*\b(?:sponsorship|visa)\b/.test(lower)
  );
}

function isAgeEligibilityQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return /\b18\s+years\s+of\s+age\s+or\s+older\b/.test(lower) || /\bat least 18 years\b/.test(lower);
}

function isPriorAppleEmploymentQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return /\bever been employed by apple\b/.test(lower);
}

function isPriorAppleContractorQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return (
    /\bapple\b/.test(lower) && /\btemporary agency worker\b/.test(lower) && /\bindependent contractor\b/.test(lower)
  );
}

const NON_ANSWER_ACTION_LABEL_PATTERN =
  /\b(edit|change|modify|update|view|remove|delete|continue|submit|apply|cancel|close|back|next|download|print|export|attach|upload|share|preview|resume)\b/i;

// Apple's review page reuses a "-edit-button" id suffix for every section's Edit link, and a
// "downloadfile" id substring for saved-file buttons (resume, cover letter) whose visible text is
// just the uploaded filename (e.g. "Yifu_Zhou_Resume.pdf") rather than a recognizable action word,
// so the label pattern above can't reliably catch those.
const NON_ANSWER_ACTION_ID_PATTERN = /-edit-button$|downloadfile/i;

function isNonAnswerAction(element) {
  const elementId = element.id || element.getAttribute("id") || "";

  if (NON_ANSWER_ACTION_ID_PATTERN.test(elementId)) {
    return true;
  }

  const label = `${getActionLabel(element)} ${getElementLabel(element)}`;
  return NON_ANSWER_ACTION_LABEL_PATTERN.test(label);
}

function isAnswerControlElement(element) {
  const isButtonLike = element.tagName.toLowerCase() === "button" || element.getAttribute("role") === "button";

  if (!isButtonLike) {
    return true;
  }

  return !isNonAnswerAction(element);
}

// Fields that must never be treated as an open-ended essay prompt, even if their label happens to
// contain a "?" or an essay-like phrase (e.g. "What company do you currently work for?"). Kept
// independent from inferFieldCategory()'s broader categories (used by the unrelated application-page
// preview feature) because that function's "experience" bucket matches on the bare word "company",
// which would wrongly swallow a real "Why do you want to work at this company?" essay question.
const PERSONAL_INFO_FIELD_LABEL_PATTERN =
  /\b(first name|last name|full name|legal name|preferred name|email|e-mail|phone|mobile|telephone|address|city|state|province|zip|postal code|country|linkedin|portfolio|website|personal site|github|referral|referred by|salary|compensation|expected pay|school|university|degree|major|gpa|current employer|current company|what company|currently work|where do you work|gender|race|ethnicity|veteran|disability)\b/i;

const ESSAY_QUESTION_LABEL_PATTERN =
  /\?|\bwhy (?:do you want|are you interested|would you|this role|this company|this team)\b|\btell us about\b|\bdescribe a time\b|\bwhat interests you\b|\bwalk us through\b|\bwhat makes you\b/i;

function isEssayQuestionLabel(label) {
  const text = normalizeText(label || "");
  return ESSAY_QUESTION_LABEL_PATTERN.test(text) && !PERSONAL_INFO_FIELD_LABEL_PATTERN.test(text);
}

function findOpenTextQuestionField() {
  const fields = Array.from(document.querySelectorAll("textarea, input[type='text']"))
    .filter((element) => isElementVisible(element))
    .filter((element) => !isActionDisabled(element))
    .filter((element) => !(element.value || "").trim());

  return fields.find((element) => isEssayQuestionLabel(getElementLabel(element))) || null;
}

function getQuestionContainers() {
  return Array.from(document.querySelectorAll("fieldset, section, div, li"))
    .filter((element) => isElementVisible(element))
    .filter((element) => {
      const text = normalizeText(element.innerText || "");
      const hasKnownQuestion =
        isWorkAuthorizationQuestion(text) ||
        isVisaSponsorshipQuestion(text) ||
        isAgeEligibilityQuestion(text) ||
        isPriorAppleEmploymentQuestion(text) ||
        isPriorAppleContractorQuestion(text);
      const answerControls = Array.from(
        element.querySelectorAll(
          [
            "select",
            "input[type='radio']",
            "[role='radio']",
            "[role='combobox']",
            "[aria-haspopup='listbox']",
            "[aria-haspopup='menu']",
            ".ud__select",
            ".ud__select__selector",
            "button",
            "[role='button']"
          ].join(", ")
        )
      );
      const hasAnswerControl = answerControls.some(isAnswerControlElement);

      return hasKnownQuestion && hasAnswerControl;
    })
    .sort((a, b) => normalizeText(a.innerText || "").length - normalizeText(b.innerText || "").length);
}

function selectNativeAnswer(container, stepName, steps, matchesAnswer, answerLabel) {
  const selects = Array.from(container.querySelectorAll("select"))
    .filter((element) => isElementVisible(element))
    .filter((element) => !isActionDisabled(element));

  for (const select of selects) {
    const option = Array.from(select.options).find((candidate) =>
      matchesAnswer(`${candidate.textContent || ""} ${candidate.value || ""}`)
    );

    if (!option) {
      continue;
    }

    select.value = option.value;
    select.dispatchEvent(new Event("input", { bubbles: true }));
    select.dispatchEvent(new Event("change", { bubbles: true }));
    steps.push({
      step: stepName,
      status: "selected",
      label: normalizeText(option.textContent || option.value || answerLabel)
    });
    return true;
  }

  return false;
}

function selectNativeYesAnswer(container, stepName, steps) {
  return selectNativeAnswer(container, stepName, steps, isYesAnswerText, "Yes");
}

function clickAnswerInContainer(container, answerPattern, stepName, steps) {
  const candidates = Array.from(
    container.querySelectorAll("label, button, [role='radio'], [role='button'], input[type='radio']")
  ).filter((element) => isElementVisible(element));

  for (const candidate of candidates) {
    const label = getActionLabel(candidate) || getElementLabel(candidate);
    const value = candidate.value || "";
    const lower = `${label} ${value}`.toLowerCase();

    if (!answerPattern.test(lower) || isActionDisabled(candidate)) {
      continue;
    }

    candidate.scrollIntoView({
      block: "center"
    });
    candidate.click();
    steps.push({
      step: stepName,
      status: "clicked",
      label: label || value
    });
    return true;
  }

  steps.push({
    step: stepName,
    status: "missing"
  });
  return false;
}

// Some sites (e.g. ByteDance's applyFormModule dropdown) render their option list with a
// virtualized list library (rc-virtual-list) that can take longer than a fixed delay to mount --
// especially on first open. Poll for a matching option to actually appear instead of guessing a
// delay, mirroring the same fix used for TikTok's client-side pagination race.
async function waitForDropdownOption(scope, matches, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const intervalMs = options.intervalMs ?? 200;
  const selector = options.selector || ".ud__select__list__item, [role='option']";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const localOptions = scope ? Array.from(scope.querySelectorAll(selector)) : [];
    const globalOptions = Array.from(document.querySelectorAll(selector));
    const match = [...localOptions, ...globalOptions]
      .filter((element, index, allOptions) => allOptions.indexOf(element) === index)
      .filter((element) => isElementVisible(element) && !isActionDisabled(element))
      .find(matches);

    if (match) {
      return match;
    }

    await delay(intervalMs);
  }

  return null;
}

async function clickDropdownAnswer(container, stepName, steps, matchesAnswer, answerLabel) {
  const controls = Array.from(
    container.querySelectorAll(
      [
        ".ud__select__selector",
        ".ud__select",
        "[role='combobox']",
        "[aria-haspopup='listbox']",
        "[aria-haspopup='menu']",
        "button",
        "[role='button']",
        "input[readonly]",
        "input[type='text']"
      ].join(", ")
    )
  )
    .filter((element) => isElementVisible(element))
    .filter((element) => !isActionDisabled(element));

  for (const control of controls) {
    if (isNonAnswerAction(control)) {
      continue;
    }

    control.scrollIntoView({
      block: "center"
    });
    await delay(150);
    control.click();

    const matchedOption = await waitForDropdownOption(
      null,
      (element) => {
        const text = normalizeText(
          `${element.innerText || ""} ${element.getAttribute("aria-label") || ""} ${element.getAttribute("title") || ""}`
        );
        return text.length <= 40 && matchesAnswer(text);
      },
      {
        selector: ".ud__select__list__item, [role='option'], [role='menuitem'], li, button, div, span",
        timeoutMs: 3000
      }
    );

    if (!matchedOption) {
      continue;
    }

    matchedOption.scrollIntoView({
      block: "center"
    });
    await delay(100);
    matchedOption.click();
    steps.push({
      step: stepName,
      status: "selected",
      label: answerLabel
    });
    await delay(300);
    return true;
  }

  return false;
}

async function clickDropdownYesAnswer(container, stepName, steps) {
  return clickDropdownAnswer(container, stepName, steps, isYesAnswerText, "Yes");
}

function getSelectedDropdownText(container) {
  const selector = container.querySelector(".ud__select__selector, [role='combobox'], [aria-haspopup='listbox']");
  const input = container.querySelector("input[role='combobox'], input[readonly]");

  return normalizeText(
    `${selector?.innerText || ""} ${input?.value || ""} ${selector?.getAttribute("aria-label") || ""}`
  );
}

async function selectTikTokYesAnswer(field, stepName, steps) {
  if (isYesAnswerText(getSelectedDropdownText(field))) {
    steps.push({
      step: stepName,
      status: "already selected",
      label: "Yes"
    });
    return true;
  }

  if (selectNativeYesAnswer(field, stepName, steps)) {
    return true;
  }

  const selector = field.querySelector(
    ".ud__select__selector, [role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='menu']"
  );

  if (!selector || !isElementVisible(selector) || isActionDisabled(selector)) {
    steps.push({
      step: stepName,
      status: "missing",
      label: "TikTok dropdown selector was not available"
    });
    return false;
  }

  selector.scrollIntoView({ block: "center" });
  await delay(150);
  selector.click();

  const yesOption = await waitForDropdownOption(field, (element) =>
    isYesAnswerText(element.innerText || element.textContent || "")
  );

  if (!yesOption) {
    const visibleOptions = Array.from(document.querySelectorAll(".ud__select__list__item, [role='option']"))
      .filter((element) => isElementVisible(element))
      .map((element) => normalizeText(element.innerText || element.textContent || ""))
      .filter(Boolean)
      .slice(0, 8);
    steps.push({
      step: stepName,
      status: "missing",
      label: visibleOptions.length ? `Visible options: ${visibleOptions.join(", ")}` : "No visible dropdown options"
    });
    return false;
  }

  yesOption.scrollIntoView({ block: "nearest" });
  await delay(100);
  yesOption.click();
  await delay(400);

  const selectedText = getSelectedDropdownText(field);
  const selected = isYesAnswerText(selectedText);
  steps.push({
    step: stepName,
    status: selected ? "selected" : "unverified",
    label: selected ? "Yes" : `Displayed value: ${selectedText || "empty"}`
  });
  return selected;
}

async function answerYesQuestion(container, stepName, steps) {
  if (selectNativeYesAnswer(container, stepName, steps)) {
    return true;
  }

  if (clickAnswerInContainer(container, /\byes\b/, stepName, steps)) {
    return true;
  }

  return clickDropdownYesAnswer(container, stepName, steps);
}

async function answerNoQuestion(container, stepName, steps) {
  if (selectNativeAnswer(container, stepName, steps, isNoAnswerText, "No")) {
    return true;
  }

  if (clickAnswerInContainer(container, /\bno\b/, stepName, steps)) {
    return true;
  }

  return clickDropdownAnswer(container, stepName, steps, isNoAnswerText, "No");
}

async function answerQuestionnaire(steps) {
  const tikTokFields = Array.from(document.querySelectorAll("[data-form-field-i18n-name]"))
    .filter((element) => isElementVisible(element))
    .map((element) => ({
      element,
      question: normalizeText(element.getAttribute("data-form-field-i18n-name") || element.innerText || "")
    }))
    .filter(({ question }) => isWorkAuthorizationQuestion(question) || isVisaSponsorshipQuestion(question));

  if (tikTokFields.length) {
    let answeredCount = 0;

    for (const { element, question } of tikTokFields) {
      const stepName = isWorkAuthorizationQuestion(question)
        ? "Answer work authorization"
        : "Answer visa sponsorship";

      if (await selectTikTokYesAnswer(element, stepName, steps)) {
        answeredCount += 1;
      }
    }

    return {
      answeredAny: answeredCount > 0,
      requiredCount: tikTokFields.length,
      answeredCount
    };
  }

  const containers = getQuestionContainers();
  const questionRules = [
    { matcher: isWorkAuthorizationQuestion, answer: answerYesQuestion, stepName: "Answer work authorization" },
    { matcher: isVisaSponsorshipQuestion, answer: answerYesQuestion, stepName: "Answer visa sponsorship" },
    { matcher: isAgeEligibilityQuestion, answer: answerYesQuestion, stepName: "Answer age eligibility" },
    {
      matcher: isPriorAppleEmploymentQuestion,
      answer: answerNoQuestion,
      stepName: "Answer prior Apple employment"
    },
    {
      matcher: isPriorAppleContractorQuestion,
      answer: answerNoQuestion,
      stepName: "Answer prior Apple contractor status"
    }
  ];

  let answeredCount = 0;
  let requiredCount = 0;

  for (const rule of questionRules) {
    const container = containers.find((candidate) => rule.matcher(normalizeText(candidate.innerText || "")));

    if (!container) {
      continue;
    }

    requiredCount += 1;

    if (await rule.answer(container, rule.stepName, steps)) {
      answeredCount += 1;
    }
  }

  return {
    answeredAny: answeredCount > 0,
    requiredCount,
    answeredCount
  };
}

async function answerOpenTextQuestion(steps) {
  const field = findOpenTextQuestionField();

  if (!field) {
    return { pausedForReview: false };
  }

  const label = getElementLabel(field);
  const stepName = `Draft answer: ${label}`;

  const response = await chrome.runtime
    .sendMessage({
      type: "APPLE_CAREERS_GENERATE_ANSWER",
      questionText: label,
      jobId: getJobId()
    })
    .catch((error) => ({ ok: false, error: error?.message }));

  const answer = response?.ok ? normalizeText(response.data?.answer || "") : "";

  if (!answer) {
    steps.push({
      step: stepName,
      status: "skipped",
      label: response?.error || "LLM answer generation is not available."
    });
    return { pausedForReview: false };
  }

  field.focus();
  field.value = answer;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.dispatchEvent(new Event("change", { bubbles: true }));
  field.scrollIntoView({ block: "center" });

  steps.push({
    step: stepName,
    status: "drafted",
    label: answer.length > 140 ? `${answer.slice(0, 140)}…` : answer
  });

  return { pausedForReview: true, questionText: label };
}

function buildStepResult(overrides) {
  return {
    url: window.location.href,
    title: document.title,
    heading: normalizeText(document.querySelector("h1, h2")?.innerText || ""),
    visibleActions: getVisibleActionLabels(),
    ...overrides
  };
}

// Mirrors waitForJobListToSettle() for the application form itself: ByteDance's SPA can still be
// hydrating the form (work-authorization dropdowns, buttons) when this step first runs right after
// the page loads. Answering/submitting against a form that hasn't finished rendering yet silently
// finds zero required questions, skips straight to hunting for Submit, and closes the tab when it
// can't be found or clicked -- intermittent, since it depends on how fast that particular page load
// happened to render. Poll until the count of interactive form elements stabilizes first.
async function waitForApplicationFormToSettle(options = {}) {
  const timeoutMs = options.timeoutMs ?? 9000;
  const intervalMs = options.intervalMs ?? 200;
  const stableChecksRequired = options.stableChecksRequired ?? 5;
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableCount = 0;

  const countInteractiveElements = () =>
    document.querySelectorAll("[data-form-field-i18n-name], select, input, textarea, button, [role='button']")
      .length;

  while (Date.now() < deadline) {
    const currentCount = countInteractiveElements();

    if (currentCount > 0 && currentCount === lastCount) {
      stableCount += 1;
      if (stableCount >= stableChecksRequired) {
        return;
      }
    } else {
      stableCount = 0;
    }

    lastCount = currentCount;
    await delay(intervalMs);
  }
}

async function runApplicationWorkflowStep() {
  const steps = [];
  const siteConfig = getSiteConfig();
  const currentUrl = getCurrentUrl();
  const isDetailPage = Boolean(siteConfig?.isJobDetailUrl(currentUrl) && !siteConfig?.isApplicationUrl(currentUrl));
  const sessionSignal = getSessionRequiredSignal();

  if (sessionSignal) {
    steps.push({
      step: "Detect login or session requirement",
      status: "detected",
      label: sessionSignal
    });
    return buildStepResult({
      clicked: false,
      done: false,
      errorType: "session_or_login_required",
      steps,
      summary: `Login or session action appears required: ${sessionSignal}`
    });
  }

  if (isDetailPage) {
    const submittedSignal = getSubmittedSignal();

    if (submittedSignal) {
      return buildStepResult({
        clicked: true,
        done: true,
        alreadySubmitted: true,
        steps: [
          {
            step: "Detect already submitted",
            status: "detected",
            label: submittedSignal.text
          }
        ],
        summary: "Job already shows Submitted."
      });
    }

    const jobId = getJobId();
    const submitResume = await waitForJobSpecificApplyAction(siteConfig, jobId, 6000);

    if (!submitResume) {
      const lateSubmittedSignal = getSubmittedSignal();

      if (lateSubmittedSignal) {
        return buildStepResult({
          clicked: true,
          done: true,
          alreadySubmitted: true,
          steps: [
            {
              step: "Detect already submitted after waiting",
              status: "detected",
              label: lateSubmittedSignal.text
            }
          ],
          summary: "Job already shows Submitted."
        });
      }
    }

    if (!submitResume) {
      return buildStepResult({
        clicked: false,
        done: false,
        steps: [
          {
            step: "Open application flow",
            status: "missing"
          }
        ],
        summary: `${siteConfig.label} apply action was not found and no Submitted state was detected.`
      });
    }

    submitResume.scrollIntoView({
      block: "center"
    });
    await delay(200);
    submitResume.click();
    steps.push({
      step: "Open application flow",
      status: "clicked",
      label: getActionLabel(submitResume)
    });
    await delay(WORKFLOW_STEP_DELAY_MS);

    return buildStepResult({
      clicked: true,
      done: false,
      steps,
      summary: `Clicked ${getActionLabel(submitResume) || "apply action"}.`
    });
  }

  await waitForApplicationFormToSettle();

  // On the final Review & Submit step, every question is shown as read-only review text (it was
  // already answered on the earlier Questions step) rather than an editable control, so there is
  // nothing for the questionnaire-answering logic below to do there. Running it anyway forces
  // ever-broader container searches (since no small container has a real answer control left,
  // they've all been correctly excluded) that can end up clicking unrelated buttons entirely --
  // Edit links, or the resume/cover-letter download buttons. Detect this step by checking whether
  // the primary action button already reads "Submit", and skip straight to it when it does.
  const primaryButtonBeforeQuestions = findPrimaryActionButton(siteConfig);
  const isReviewAndSubmitStep =
    Boolean(primaryButtonBeforeQuestions) &&
    (siteConfig?.finalSubmitPattern || /^submit$/i).test(getActionLabel(primaryButtonBeforeQuestions));

  let answeredQuestionnaire = false;
  let answeredSponsorship = false;

  if (!isReviewAndSubmitStep) {
    const questionnaireResult = await answerQuestionnaire(steps);
    answeredQuestionnaire = questionnaireResult.answeredAny;
    answeredSponsorship = answeredQuestionnaire ? false : clickSponsorshipAnswer(steps);

    if (answeredQuestionnaire || answeredSponsorship) {
      await delay(500);
    }

    if (
      questionnaireResult.requiredCount > 0 &&
      questionnaireResult.answeredCount < questionnaireResult.requiredCount
    ) {
      return buildStepResult({
        clicked: answeredQuestionnaire,
        done: false,
        steps,
        errorType: "questionnaire_incomplete",
        summary: `Answered ${questionnaireResult.answeredCount} of ${questionnaireResult.requiredCount} required authorization questions; Submit was not clicked.`
      });
    }

    const openTextResult = await answerOpenTextQuestion(steps);

    if (openTextResult.pausedForReview) {
      return buildStepResult({
        clicked: true,
        done: false,
        pausedForReview: true,
        errorType: "open_text_review_required",
        steps,
        summary: `Drafted an answer for "${openTextResult.questionText}" — switch to this tab to review before submitting.`
      });
    }
  }

  const loadingSignal = getLoadingSignal();
  if (
    loadingSignal &&
    !findClickableByText(siteConfig?.finalSubmitPattern || /^submit$/i) &&
    !findClickableByText(siteConfig?.continuePattern || /^continue$/i)
  ) {
    steps.push({
      step: "Wait for application page",
      status: "loading",
      label: loadingSignal
    });
    return buildStepResult({
      clicked: true,
      done: false,
      steps,
      summary: "Application page is still loading."
    });
  }

  const primaryActionResult = await clickPrimaryAction(siteConfig, steps);

  if (primaryActionResult.done) {
    return buildStepResult({
      clicked: true,
      done: true,
      alreadySubmitted: Boolean(primaryActionResult.alreadySubmitted),
      errorType: primaryActionResult.errorType || null,
      steps,
      summary: primaryActionResult.summary
    });
  }

  if (primaryActionResult.pending) {
    return buildStepResult({
      clicked: true,
      done: false,
      steps,
      summary: primaryActionResult.summary
    });
  }

  return buildStepResult({
    clicked: primaryActionResult.clicked || answeredQuestionnaire || answeredSponsorship,
    done: false,
    steps,
    summary: primaryActionResult.clicked
      ? primaryActionResult.summary
      : answeredQuestionnaire || answeredSponsorship
        ? "Answered questionnaire."
        : "No Continue or Submit action was found on this application step."
  });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "APPLE_CAREERS_EXTRACT_JOB") {
    sendResponse({
      ok: true,
      data: extractJobDetails({
        userYearsOfExperience: message.userYearsOfExperience,
        noMatchKeywords: message.noMatchKeywords
      })
    });

    return true;
  }

  if (message?.type === "APPLE_CAREERS_ANALYZE_APPLICATION_PAGE") {
    sendResponse({
      ok: true,
      data: analyzeApplicationPage()
    });

    return true;
  }

  if (message?.type === "APPLE_CAREERS_RUN_APPLICATION_WORKFLOW_STEP") {
    runApplicationWorkflowStep()
      .then((data) => {
        sendResponse({
          ok: true,
          data
        });
      })
      .catch((error) => {
        sendResponse({
          ok: false,
          error: error?.message || "The application workflow step failed."
        });
      });

    return true;
  }

  if (message?.type === "APPLE_CAREERS_COLLECT_JOB_LINKS") {
    waitForJobListToSettle().then(() => {
      const links = collectJobLinks();
      const siteConfig = getSiteConfig();
      const currentUrl = getCurrentUrl();
      const currentJob = siteConfig?.isJobDetailUrl(currentUrl) || siteConfig?.isApplicationUrl(currentUrl)
        ? {
            site: siteConfig.id,
            siteLabel: siteConfig.label,
            url: window.location.href,
            jobId: getJobId(),
            title: getJobTitle(),
            alreadyAppliedFromList: Boolean(getSubmittedSignal()),
            isCurrentPage: true
          }
        : null;

      sendResponse({
        ok: true,
        data: {
          site: siteConfig?.id || "unknown",
          siteLabel: siteConfig?.label || "Unsupported site",
          url: window.location.href,
          currentPage: getCurrentResultsPage(),
          currentJob,
          links,
          listStats: getJobListStats(links),
          hasNextPage: Boolean(getNextPageControl())
        }
      });
    });

    return true;
  }

  if (message?.type === "APPLE_CAREERS_GO_TO_NEXT_PAGE") {
    goToNextPage().then(sendResponse);
    return true;
  }

  return false;
});
