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
    label: "Hardware/Chip Verification",
    terms: [
      "cpu architecture",
      "microarchitecture",
      "processor verification",
      "cpu validation",
      "rtl",
      "verilog",
      "systemverilog",
      "silicon validation",
      "silicon bring-up",
      "silicon bring up",
      "soc validation",
      "asic",
      "fpga",
      "chip design"
    ],
    weight: 6
  },
  {
    label: "GPU/Graphics Engineering",
    terms: ["gpu architecture", "gpu validation", "graphics validation", "shader", "cuda", "opengl", "open gl"],
    weight: 6
  },
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
    terms: ["backend", "back-end", "server-side", "server side", "backend engineering", "backend development"],
    weight: 5
  },
  {
    label: "Full Stack Engineering",
    terms: ["full stack", "full-stack", "frontend", "front-end", "web application", "web app"],
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
    roleTerms: ["ios", "objective-c", "objective c", "uikit", "swiftui", "xcode", "cocoa touch"],
    resumeTerms: ["ios", "objective-c", "objective c", "uikit", "swiftui", "xcode", "cocoa touch"],
    penalty: 16
  },
  {
    label: "macOS app development",
    roleTerms: ["appkit", "cocoa", "core data"],
    resumeTerms: ["appkit", "cocoa", "core data"],
    penalty: 10
  },
  {
    label: "mobile app UI",
    roleTerms: ["mobile app", "mobile applications", "client app", "native app"],
    resumeTerms: ["mobile app", "mobile applications", "client app", "native app"],
    penalty: 8
  },
  {
    label: "embedded/driver development",
    roleTerms: ["firmware", "kernel", "device driver", "drivers", "embedded"],
    resumeTerms: ["firmware", "kernel", "device driver", "drivers", "embedded"],
    penalty: 8
  },
  {
    label: "silicon, processor, or GPU engineering",
    roleTerms: [
      "silicon",
      "cpu architecture",
      "cpu validation",
      "cpu performance",
      "processor verification",
      "microarchitecture",
      "gpu",
      "gpu architecture",
      "gpu validation",
      "graphics validation",
      "shader",
      "cuda",
      "soc",
      "asic",
      "rtl",
      "verilog",
      "fpga",
      "semiconductor",
      "chip design",
      "mixed-signal",
      "memory validation",
      "design verification"
    ],
    resumeTerms: [
      "silicon",
      "cpu architecture",
      "cpu validation",
      "cpu performance",
      "processor verification",
      "microarchitecture",
      "gpu",
      "gpu architecture",
      "gpu validation",
      "graphics validation",
      "shader",
      "cuda",
      "soc",
      "asic",
      "rtl",
      "verilog",
      "fpga",
      "semiconductor",
      "chip design",
      "mixed-signal",
      "memory validation",
      "design verification"
    ],
    penalty: 24
  },
  {
    label: "retail or sales work",
    roleTerms: [
      "us expert",
      "united states expert",
      "apple store expert",
      "retail expert",
      "retail sales",
      "sales expert",
      "store sales",
      "retail specialist"
    ],
    resumeTerms: ["retail", "sales", "store associate", "retail specialist", "customer-facing"],
    penalty: 24
  }
];

const SENIORITY_RULES = [
  { label: "senior title", terms: ["senior software engineer", "sr. software engineer", "senior engineer"], penalty: 6 },
  { label: "staff/principal title", terms: ["staff engineer", "principal engineer", "lead engineer"], penalty: 10 },
  { label: "high ownership requirement", terms: ["technical lead", "leadership", "mentor junior", "architect"], penalty: 4 }
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
const MAX_FINAL_SUBMIT_ATTEMPTS = 3;
const MAX_VALIDATION_RECOVERY_ATTEMPTS = 3;
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

// A "10+ years" mention isn't always about how much experience the CANDIDATE needs -- postings
// routinely describe the team/company/platform's own tenure ("10+ years of engineering investment",
// "8+ years of combined experience across the team") using the exact same years+experience wording a
// real requirement sentence uses. Left unfiltered, that got misread as a YOE requirement and could
// hard-skip a strong match on a sentence that was never about the candidate at all -- caught from a
// live TikTok posting mentioning the team's own experience, not a requirement.
const NON_CANDIDATE_YEARS_CONTEXT_PATTERN =
  /\b(?:our|the)\s+(?:team|company|platform|organization|product)\b[^.!?]{0,40}\b(?:has|have)\b|\bcombined\s+(?:years|experience)\b|\bacross\s+the\s+team\b|\byears?\s+in\s+business\b|\bsince\s+(?:our|its)\s+founding\b/i;

function sentenceMentionsRequirement(sentence) {
  const lower = sentence.toLowerCase();
  return (
    /\b(years?|yrs?)\b/.test(lower) &&
    /\b(experience|professional|industry|software|engineering|development|work)\b/.test(lower) &&
    !NON_CANDIDATE_YEARS_CONTEXT_PATTERN.test(sentence)
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

function analyzeResumeMatch(text, resumeProfileText = "") {
  const matched = RESUME_KEYWORDS.map((keyword) => {
    const candidateTerms = keyword.terms.filter((term) => textIncludesTerm(resumeProfileText, term));
    const matchedTerms = candidateTerms.filter((term) => textIncludesTerm(text, term));
    return { ...keyword, candidateTerms, matchedTerms };
  }).filter((keyword) => keyword.matchedTerms.length > 0);
  const categorizedScore = matched.reduce((total, keyword) => total + keyword.weight, 0);
  const categorizedTerms = matched.flatMap((keyword) => keyword.matchedTerms);
  const additionalSkillTerms = extractResumeSkillTerms(resumeProfileText).filter(
    (term) =>
      textIncludesTerm(text, term) &&
      !categorizedTerms.some((knownTerm) => knownTerm.toLowerCase() === term.toLowerCase())
  );
  const score = categorizedScore + Math.min(12, additionalSkillTerms.length * 2);
  const percentage = Math.min(100, Math.round((score / 30) * 100));

  return {
    score,
    percentage,
    keywords: [
      ...matched.map((keyword) => keyword.label),
      ...(additionalSkillTerms.length ? ["Other candidate skills"] : [])
    ],
    matchedTerms: [...categorizedTerms, ...additionalSkillTerms],
    hasCandidateProfile: Boolean(String(resumeProfileText || "").trim())
  };
}

function extractResumeSkillTerms(resumeProfileText) {
  const skillLabels =
    /^(?:domain expertise|programming languages|frameworks|ml\/ai|backend|frontend|cloud|databases|infrastructure|distributed systems|data engineering|protocols\/apis|tools|other|technologies|technical skills|skills)\s*:\s*(.+)$/i;
  const terms = new Set();

  for (const line of String(resumeProfileText || "").split(/\r?\n/)) {
    const match = line.trim().match(skillLabels);
    if (!match) continue;
    for (const term of match[1].split(/[,;|]/)) {
      const normalized = term.trim();
      if (normalized.length >= 2) terms.add(normalized);
    }
  }

  return Array.from(terms);
}

function scoreRules(text, rules) {
  return rules
    .map((rule) => ({
      ...rule,
      matchedTerms: rule.terms.filter((term) => textIncludesTerm(text, term))
    }))
    .filter((rule) => rule.matchedTerms.length > 0);
}

function scoreDomainMismatches(text, resumeProfileText, rules) {
  return rules
    .map((rule) => ({
      ...rule,
      matchedTerms: rule.roleTerms.filter((term) => textIncludesTerm(text, term)),
      candidateEvidence: rule.resumeTerms.filter((term) => textIncludesTerm(resumeProfileText, term))
    }))
    .filter((rule) => rule.matchedTerms.length > 0 && rule.candidateEvidence.length === 0);
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

function analyzeLocalMatch(text, noMatchKeywords = [], resumeProfileText = "") {
  const resumeMatch = analyzeResumeMatch(text, resumeProfileText);
  const domainMismatches = scoreDomainMismatches(text, resumeProfileText, DOMAIN_MISMATCH_RULES);
  const senioritySignals = scoreRules(text, SENIORITY_RULES);
  // A no-match keyword mentioned only under "Preferred Qualifications" is a nice-to-have, not a
  // reason to hard-skip -- only count it if it also appears somewhere outside that section
  // (Minimum Qualifications, Responsibilities, or unstructured postings with no section headers).
  const noMatchScanText = excludePreferredSectionText(text);
  const noMatchKeywordHits = noMatchKeywords.filter((term) => term && textIncludesTerm(noMatchScanText, term));
  const mismatchPenalty = domainMismatches.reduce((total, rule) => total + rule.penalty, 0);
  const seniorityPenalty = senioritySignals.reduce((total, rule) => total + rule.penalty, 0);
  const score = resumeMatch.score - mismatchPenalty - seniorityPenalty;

  return {
    score,
    percentage: Math.max(0, Math.min(100, Math.round((score / 30) * 100))),
    positiveScore: resumeMatch.score,
    hasCandidateProfile: resumeMatch.hasCandidateProfile,
    mismatchPenalty,
    seniorityPenalty,
    keywords: resumeMatch.keywords,
    matchedTerms: resumeMatch.matchedTerms,
    domainMismatches: domainMismatches.map((rule) => rule.label),
    senioritySignals: senioritySignals.map((rule) => rule.label),
    noMatchKeywordHits,
    reasons: [
      ...resumeMatch.matchedTerms.map((term) => `Candidate profile and role overlap: ${term}`),
      ...domainMismatches.map((rule) => `Domain gap: ${rule.label}; role signals: ${rule.matchedTerms.join(", ")}`),
      ...senioritySignals.map((rule) => `Seniority signal: ${rule.label}`),
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

  if (!matchScore.hasCandidateProfile) {
    return {
      decision: "Unknown",
      requiredYears: maxRequiredYears,
      reason: "No parsed resume profile was supplied for local matching."
    };
  }

  if (matchScore.mismatchPenalty >= 16) {
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
      /\b(application|resume)?\s*submitted\b/.test(lower) ||
      /\bwe (?:have|'ve) received your (?:resume|application)\b/.test(lower)
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
  // .ud__confirm__content and its .ud__confirm__body child are confirmed ByteDance "Application
  // Failed" dialog shapes -- body "You've already applied for this job. Unable to apply again.",
  // buttons "View more jobs"/"Cancel" (neither a
  // Continue/Submit label). Without a selector match here, getAlreadyAppliedSignal() (checked early in
  // the workflow step, before the Continue/Submit search below) silently returns null and the workflow
  // falls all the way through to that later search, which then fails with a confusing "No Continue or
  // Submit action was found" error instead of correctly recognizing this as already-applied. The
  // existing .uddialogwrap/.uddialogcontent/.udconfirm selectors (no double underscore) don't match
  // this BEM naming at all -- a different ByteDance dialog family already had this same gap fixed once
  // for a toast and once for an inline notice (see getAlreadyAppliedToast/getAlreadyAppliedNotice's own
  // comments); this is that same class of gap, a third time, for a real modal confirm dialog.
  const dialogs = Array.from(
    document.querySelectorAll(
      "[role='dialog'], .uddialogwrap, .uddialogcontent, .udconfirm, .ud__confirm__content, [class*='confirm__content'], .ud__confirm__body, [class*='confirm__body']"
    )
  ).filter((element) => isElementVisible(element));

  for (const dialog of dialogs) {
    const text = normalizeText(dialog.innerText || dialog.textContent || "");

    if (isAlreadyAppliedDialogText(text)) {
      const titleElement = dialog.querySelector(
        ".udconfirmtitleContent, [class*='confirmtitle'], .ud__confirm__titleContent, [class*='confirm__title']"
      );
      const bodyElement = dialog.querySelector(
        ".udconfirmbody, [class*='confirmbody'], .ud__confirm__body, [class*='confirm__body']"
      );

      return {
        element: dialog,
        text: text.slice(0, 240),
        title: normalizeText(titleElement?.innerText || titleElement?.textContent || ""),
        body: normalizeText(bodyElement?.innerText || bodyElement?.textContent || "")
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
    const text = normalizeText(toast.innerText || toast.textContent || "");

    if (isAlreadyAppliedDialogText(text)) {
      return {
        element: toast,
        text: text.slice(0, 240)
      };
    }
  }

  return null;
}

// A separate ByteDance UI variant renders the "already applied" message as an inline notice/alert
// banner (ud__notice-error, role="alert") baked into the application form itself, rather than as a
// dialog or a self-dismissing toast -- neither getAlreadyAppliedDialog() nor getAlreadyAppliedToast()
// matches this shape.
function getAlreadyAppliedNotice() {
  const notices = Array.from(
    document.querySelectorAll("[role='alert'], .ud__notice-error, [class*='notice-error']")
  ).filter((element) => isElementVisible(element));

  for (const notice of notices) {
    const text = normalizeText(notice.innerText || notice.textContent || "");

    if (isAlreadyAppliedDialogText(text)) {
      return {
        element: notice,
        text: text.slice(0, 240)
      };
    }
  }

  return null;
}

function getAlreadyAppliedPageTextSignal() {
  if (getSiteConfig()?.id !== "tiktok") {
    return null;
  }

  // ByteDance has multiple independently-versioned popup wrappers. The visible message itself is
  // stable, so use it as a last-resort signal when none of the known dialog/toast/alert selectors
  // match. Keep the patterns candidate-directed and job-specific so an unrelated "already applied"
  // phrase elsewhere on the page cannot terminate an application.
  const pageText = normalizeText(document.body?.innerText || "").replace(/\s+/g, " ");
  const messagePatterns = [
    /\byou(?:['’]ve| have)? already applied (?:for|to) this (?:job|position)\b(?:.{0,160}\b(?:unable|cannot|can't|can’t|not able) (?:to )?apply again\b)?/i,
    /\balready applied (?:for|to) this (?:job|position)\b.{0,160}\b(?:unable|cannot|can't|can’t|not able) (?:to )?apply again\b/i,
    /\bapplication failed\b.{0,240}\balready applied\b/i
  ];
  const match = messagePatterns.map((pattern) => pageText.match(pattern)).find(Boolean);

  if (!match) {
    return null;
  }

  return {
    element: document.body,
    text: normalizeText(match[0]).slice(0, 240)
  };
}

function getAlreadyAppliedSignal() {
  return (
    getAlreadyAppliedDialog() ||
    getAlreadyAppliedToast() ||
    getAlreadyAppliedNotice() ||
    getAlreadyAppliedPageTextSignal()
  );
}

// Checked immediately before the final Submit click. Keep this to semantic ARIA signals plus
// ByteDance Formily's exact feedback-error class family rather than a broad ".error"/".invalid"
// guess: fuzzy class matching sees inactive styling containers and blocks legitimate submissions.
function isKnownFormValidationFeedback(element) {
  const classTokens = String(element?.className || "").split(/\s+/);
  return classTokens.some((token) => /^ud-formily-item-feedback-errors?/.test(token));
}

function getVisibleValidationMessageElements(root = document) {
  const alerts = Array.from(root.querySelectorAll?.("[role='alert']") || []);
  const formilyFeedback = Array.from(
    root.querySelectorAll?.("[class*='ud-formily-item-feedback-error']") || []
  ).filter(isKnownFormValidationFeedback);

  return [...new Set([...alerts, ...formilyFeedback])].filter(
    (element) =>
      isElementVisible(element) && Boolean(normalizeText(element.innerText || element.textContent || ""))
  );
}

function getVisibleValidationErrors() {
  const alertMessages = getVisibleValidationMessageElements()
    .map((element) => normalizeText(element.innerText || element.textContent || ""))
    .filter(Boolean);

  const invalidFieldCount = Array.from(document.querySelectorAll("[aria-invalid='true']")).filter(isElementVisible).length;

  const messages = [...new Set(alertMessages)].slice(0, 5);
  if (invalidFieldCount > 0) {
    messages.push(`${invalidFieldCount} field(s) marked invalid`);
  }

  return messages;
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

    const validationErrors = getVisibleValidationErrors();
    if (validationErrors.length > 0) {
      return { type: "validation", errors: validationErrors };
    }

    await delay(intervalMs);
  }

  return null;
}

function extractJobDetails(options = {}) {
  const text = getVisiblePageText();
  const matches = extractExperienceMatches(text);
  const noMatchKeywords = normalizeNoMatchKeywords(options.noMatchKeywords);
  const matchScore = analyzeLocalMatch(text, noMatchKeywords, options.resumeProfileText);
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

function extractAppleSubmittedRoleDetails() {
  const descriptionElement = document.querySelector("#jobdetails-jobdescription");
  const minimumElement = document.querySelector("#jobdetails-minimumqualifications");
  const preferredElement = document.querySelector("#jobdetails-preferredqualifications");
  const description = normalizeText(descriptionElement?.innerText || "");
  const minimumQualifications = normalizeText(minimumElement?.innerText || "");
  const preferredQualifications = normalizeText(preferredElement?.innerText || "");
  const title = getJobTitle();
  const jobId = getJobId();
  const jobText = [description, minimumQualifications, preferredQualifications].filter(Boolean).join("\n\n");
  const ready = Boolean(
    jobId &&
    title &&
    description.length > 80 &&
    minimumQualifications.length > 25 &&
    (!preferredElement || preferredQualifications.length > 25)
  );

  return {
    jobId,
    title,
    url: window.location.href,
    description,
    minimumQualifications,
    preferredQualifications,
    jobText: jobText.slice(0, 12000),
    requiredExperience: extractExperienceMatches(jobText)
      .filter((match) => match.type === "required")
      .flatMap((match) => (match.years || []).map((years) => ({ years, type: match.type, sentence: match.sentence }))),
    ready
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

// This interview-in-progress role is user-designated as never batch-withdrawable. Keep the guard in
// the page action layer too, so stale side-panel state cannot bypass it.
const APPLE_ROLE_IDS_PROTECTED_FROM_BATCH_WITHDRAWAL = new Set(["200654506"]);

function collectSubmittedRoleCards() {
  const roles = new Map();

  for (const anchor of document.querySelectorAll('a[href*="/en-us/details/"]')) {
    if (!isElementVisible(anchor)) {
      continue;
    }

    const url = new URL(anchor.href, window.location.href);
    const jobId = getJobIdFromUrl(url.href);
    if (!jobId || roles.has(jobId)) {
      continue;
    }

    let card = anchor;
    while (card && card !== document.body) {
      const hasWithdrawButton = Array.from(card.querySelectorAll("button")).some((button) =>
        /\bwithdraw\b/i.test(`${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`)
      );
      if (hasWithdrawButton && card.querySelectorAll('a[href*="/en-us/details/"]').length === 1) {
        break;
      }
      card = card.parentElement;
    }

    const cardText = normalizeText(card?.innerText || "");
    const title = cleanTitle(anchor.innerText || anchor.getAttribute("aria-label") || "Untitled job")
      .replace(new RegExp(`\\s+${jobId}$`), "")
      .trim();
    const submittedDate = cardText.match(/\bSubmitted\s*[-–]\s*([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i)?.[1] || null;
    const withdrawButton = card && Array.from(card.querySelectorAll("button")).find((button) =>
      /\bwithdraw\b/i.test(`${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`)
    );
    const favoriteCheckbox = card?.querySelector('input[type="checkbox"][id^="addToFavoriteId-favorite-"]');

    roles.set(jobId, {
      jobId,
      title,
      url: url.href,
      submittedDate,
      cardText: cardText.slice(0, 700),
      favorite: favoriteCheckbox ? Boolean(favoriteCheckbox.checked) : null,
      protectedFromBatchWithdrawal:
        APPLE_ROLE_IDS_PROTECTED_FROM_BATCH_WITHDRAWAL.has(jobId) || !favoriteCheckbox || favoriteCheckbox.checked,
      active: Boolean(withdrawButton)
    });
  }

  return Array.from(roles.values());
}

function getAppleHistoryPageIndex() {
  const input = document.querySelector('#profile-roles-pagination input[type="number"]');
  const value = Number(input?.value);
  return Number.isFinite(value) ? value : null;
}

async function waitForSubmittedRolePageChange(previousFirstJobId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await delay(200);
    const firstJobId = collectSubmittedRoleCards()[0]?.jobId || null;
    if (firstJobId && firstJobId !== previousFirstJobId) {
      return true;
    }
  }
  return false;
}

async function collectAppleSubmittedHistory() {
  if (getSiteId() !== "apple" || !/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
    throw new Error("Open your Apple Careers roles page first.");
  }
  if (!/your active submitted roles/i.test(document.body?.innerText || "")) {
    throw new Error('Choose Submissions, then the "Active" filter before analyzing roles.');
  }

  const originalPageIndex = getAppleHistoryPageIndex();
  const rolesById = new Map();
  let pageCount = 0;
  let navigationError = null;

  try {
    while (pageCount < 100) {
      const pageRoles = collectSubmittedRoleCards();
      if (pageRoles.length === 0) {
        throw new Error("No submitted role cards were found on the current page.");
      }
      for (const role of pageRoles) rolesById.set(role.jobId, role);
      pageCount += 1;

      const nextButton = document.querySelector('#profile-roles-pagination button[aria-label="Next Page"]');
      if (!nextButton || nextButton.disabled || nextButton.getAttribute("aria-disabled") === "true") {
        break;
      }

      const previousFirstJobId = pageRoles[0]?.jobId || null;
      nextButton.click();
      if (!(await waitForSubmittedRolePageChange(previousFirstJobId))) {
        navigationError = "Apple's submitted roles page did not change after selecting Next Page.";
        break;
      }
    }
  } finally {
    const currentPageIndex = getAppleHistoryPageIndex();
    if (originalPageIndex !== null && currentPageIndex !== null && currentPageIndex !== originalPageIndex) {
      const direction = currentPageIndex > originalPageIndex ? "Previous Page" : "Next Page";
      const count = Math.abs(currentPageIndex - originalPageIndex);
      for (let index = 0; index < count; index += 1) {
        const button = document.querySelector(`#profile-roles-pagination button[aria-label="${direction}"]`);
        if (!button || button.disabled) break;
        const previousFirstJobId = collectSubmittedRoleCards()[0]?.jobId || null;
        button.click();
        if (!(await waitForSubmittedRolePageChange(previousFirstJobId))) break;
      }
    }
  }

  return {
    roles: Array.from(rolesById.values()),
    pagesRead: pageCount,
    pageCount: Number(document.querySelector("[data-autom='paginationTotalPages']")?.textContent) || pageCount,
    navigationError
  };
}

function findSubmittedRoleCard(jobId) {
  const anchor = Array.from(document.querySelectorAll('a[href*="/en-us/details/"]')).find((candidate) =>
    getJobIdFromUrl(candidate.href) === String(jobId)
  );
  if (!anchor) return null;

  let card = anchor;
  while (card && card !== document.body) {
    const withdrawButton = Array.from(card.querySelectorAll("button")).find((button) =>
      /\bwithdraw\b/i.test(`${button.innerText || ""} ${button.getAttribute("aria-label") || ""}`)
    );
    if (withdrawButton && card.querySelectorAll('a[href*="/en-us/details/"]').length === 1) {
      const favoriteCheckbox = card.querySelector('input[type="checkbox"][id^="addToFavoriteId-favorite-"]');
      return {
        card,
        withdrawButton,
        title: cleanTitle(anchor.innerText || ""),
        jobId: getJobIdFromUrl(anchor.href),
        favorite: favoriteCheckbox ? Boolean(favoriteCheckbox.checked) : null
      };
    }
    card = card.parentElement;
  }
  return null;
}

async function findSubmittedRoleOnAnyPage(jobId) {
  while (true) {
    const previousButton = document.querySelector('#profile-roles-pagination button[aria-label="Previous Page"]');
    if (!previousButton || previousButton.disabled || previousButton.getAttribute("aria-disabled") === "true") break;
    const previousFirstJobId = collectSubmittedRoleCards()[0]?.jobId || null;
    previousButton.click();
    if (!(await waitForSubmittedRolePageChange(previousFirstJobId))) break;
  }

  const visited = new Set();
  while (true) {
    const pageIndex = getAppleHistoryPageIndex();
    if (pageIndex !== null && visited.has(pageIndex)) return null;
    if (pageIndex !== null) visited.add(pageIndex);

    const match = findSubmittedRoleCard(jobId);
    if (match) return match;

    const nextButton = document.querySelector('#profile-roles-pagination button[aria-label="Next Page"]');
    if (!nextButton || nextButton.disabled || nextButton.getAttribute("aria-disabled") === "true") return null;
    const previousFirstJobId = collectSubmittedRoleCards()[0]?.jobId || null;
    nextButton.click();
    if (!(await waitForSubmittedRolePageChange(previousFirstJobId))) return null;
  }
}

async function waitForSubmittedRoleWithdrawal(jobId, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!findSubmittedRoleCard(jobId)) return true;
    await delay(300);
  }
  return false;
}

function findAppleWithdrawalConfirmationModal() {
  const modal = Array.from(document.querySelectorAll(".rc-overlay-popup-outer")).find((candidate) => {
    if (!isElementVisible(candidate)) return false;
    const heading = candidate.querySelector("#yourroles-withdrawmodal-header");
    return normalizeText(heading?.innerText || heading?.textContent || "") ===
      "Are you sure you want to withdraw this submission?";
  });
  if (!modal) return null;

  const proceedButton = modal.querySelector("#yourroles-withdrawmodal-proceed-button");
  return proceedButton && isElementVisible(proceedButton)
    ? { modal, proceedButton }
    : { modal, proceedButton: null };
}

async function waitForAppleWithdrawalConfirmationModal(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const confirmation = findAppleWithdrawalConfirmationModal();
    if (confirmation) return confirmation;
    await delay(150);
  }
  return null;
}

async function waitForAppleWithdrawalConfirmationToClose(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!findAppleWithdrawalConfirmationModal()) return true;
    await delay(150);
  }
  return false;
}

async function withdrawAppleSubmittedRoles(requestedRoles = []) {
  if (getSiteId() !== "apple" || !/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
    throw new Error("Open your Apple Careers roles page before withdrawing applications.");
  }

  const roles = requestedRoles.slice(0, 250);
  const withdrawn = [];
  const failed = [];

  for (const role of roles) {
    if (findAppleWithdrawalConfirmationModal()) {
      failed.push({ jobId: role.jobId, title: role.title, error: "A withdrawal confirmation is already open; the batch stopped for manual review." });
      break;
    }

    const match = await findSubmittedRoleOnAnyPage(role.jobId);
    if (!match) {
      failed.push({ jobId: role.jobId, title: role.title, error: "The active role could not be found." });
      break;
    }

    if (
      match.favorite !== false ||
      APPLE_ROLE_IDS_PROTECTED_FROM_BATCH_WITHDRAWAL.has(String(match.jobId || role.jobId))
    ) {
      failed.push({
        jobId: role.jobId,
        title: role.title,
        error: APPLE_ROLE_IDS_PROTECTED_FROM_BATCH_WITHDRAWAL.has(String(match.jobId || role.jobId))
          ? "This role is protected from batch withdrawal because you have an interview in progress."
          : match.favorite === true
            ? "This role is starred and is protected from batch withdrawal."
            : "The role's starred status could not be verified, so batch withdrawal was stopped."
      });
      break;
    }

    match.withdrawButton.click();
    const confirmation = await waitForAppleWithdrawalConfirmationModal();
    if (!confirmation) {
      failed.push({ jobId: role.jobId, title: role.title, error: "Apple's withdrawal confirmation did not appear; the batch stopped before confirming this application." });
      break;
    }
    if (!confirmation.proceedButton || confirmation.proceedButton.disabled || confirmation.proceedButton.getAttribute("aria-disabled") === "true") {
      failed.push({ jobId: role.jobId, title: role.title, error: "Apple's withdrawal confirmation is missing an enabled Proceed button; the batch stopped for manual review." });
      break;
    }

    confirmation.proceedButton.click();
    if (!(await waitForAppleWithdrawalConfirmationToClose())) {
      failed.push({ jobId: role.jobId, title: role.title, error: "Apple's withdrawal confirmation did not close after Proceed; the batch stopped." });
      break;
    }

    if (!(await waitForSubmittedRoleWithdrawal(role.jobId))) {
      failed.push({ jobId: role.jobId, title: role.title, error: "Apple did not confirm that this application was withdrawn." });
      break;
    }
    withdrawn.push({ jobId: role.jobId, title: role.title });
  }

  return { withdrawn, failed };
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
  const lower = String(label || "").toLowerCase();

  return (
    Boolean(element?.required) ||
    element?.getAttribute?.("aria-required") === "true" ||
    /\brequired\b|\*/.test(lower)
  );
}

function isQuestionControlRequired(element, label) {
  const text = String(label || "");

  if (isOptionalApplicationQuestion(element, text)) {
    return false;
  }

  const container =
    element?.closest?.(
      "[data-form-field-i18n-name], [data-form-field-id], .ud-formily-item, fieldset, [role='radiogroup'], [role='group']"
    ) || element;
  const containerText = normalizeText(container?.innerText || "").slice(0, 1000);
  const combinedText = normalizeText(`${text} ${containerText}`);
  const hasExplicitMarker =
    /\*|\(\s*required\s*\)|\brequired\s*$|\bmandatory\s+for\s+applicants?\b|\(\s*mandatory\s*\)|\bmandatory\s*$/i.test(combinedText);

  if (isOptionalApplicationQuestion(element, containerText)) {
    return false;
  }

  if (Boolean(element?.required) || element?.getAttribute?.("aria-required") === "true") {
    return true;
  }

  if (Boolean(container?.required) || container?.getAttribute?.("aria-required") === "true") {
    return true;
  }

  const hasRequiredDescendant = Boolean(
    container?.querySelector?.("input[required], select[required], textarea[required], [aria-required='true']")
  );

  return hasRequiredDescendant || hasExplicitMarker;
}

function isOptionalApplicationQuestionText(text) {
  return /\b(?:optional|voluntary)\b|\bnot\s+mandatory\b/i.test(String(text || ""));
}

function isOptionalApplicationQuestion(element, label) {
  if (isOptionalApplicationQuestionText(label)) {
    return true;
  }
  if (!/\b(?:gender|race|ethnicity|veteran|disabilit(?:y|ies))\b/i.test(String(label || ""))) {
    return false;
  }

  let node = getAgentFieldContainer(element);
  for (let depth = 0; node && depth < 5; depth += 1) {
    if (isOptionalApplicationQuestionText(normalizeText(node.innerText || ""))) {
      return true;
    }
    node = node.parentElement;
  }
  return false;
}

function isTikTokAuthorizationModuleQuestion(element, question) {
  const text = normalizeText(question || "");

  if (
    isOptionalApplicationQuestionText(text) ||
    (!isWorkAuthorizationQuestion(text) && !isVisaSponsorshipQuestion(text))
  ) {
    return false;
  }

  // Some ByteDance application variants render the mandatory Work Authorization module without
  // required/aria-required/asterisk markers. Keep the exception tied to that named module and the
  // two deterministic authorization policies; unrelated unmarked questions remain optional/skipped.
  let ancestor = element;
  for (let depth = 0; ancestor && depth < 8; depth += 1) {
    const classTokens = String(ancestor.className || "").split(/\s+/);
    if (classTokens.some((token) => /^applyFormModuleWrapper__/.test(token))) {
      const title = normalizeText(
        ancestor.querySelector?.("[class*='applyFormModuleWrapper-title']")?.innerText || ""
      );
      const moduleText = normalizeText(ancestor.innerText || "");
      return /\bwork authorization\b/i.test(title) || /^work authorization\b/i.test(moduleText);
    }
    ancestor = ancestor.parentElement;
  }

  return false;
}

function shouldAnswerTikTokAuthorizationField(element, question) {
  if (isOptionalApplicationQuestionText(question)) {
    return false;
  }
  return isQuestionControlRequired(element, question) || isTikTokAuthorizationModuleQuestion(element, question);
}

function getAgentFieldContainer(element) {
  return element?.closest?.(
    "[data-form-field-i18n-name], [data-form-field-id], .ud-formily-item, fieldset, [role='radiogroup'], [role='group'], label"
  ) || element;
}

function isValidationBlockedControl(element) {
  const container = getAgentFieldContainer(element);
  return (
    element?.getAttribute?.("aria-invalid") === "true" ||
    container?.getAttribute?.("aria-invalid") === "true" ||
    Boolean(container?.querySelector?.("[aria-invalid='true']")) ||
    getVisibleValidationMessageElements(container).length > 0
  );
}

function isApplicationFormControl(element) {
  return Boolean(
    element?.closest?.(
      "form, [data-form-field-i18n-name], [data-form-field-id], .ud-formily-item, fieldset, [role='radiogroup'], [role='group']"
    )
  );
}

function shouldAgentAnswerRequiredControl(element, question, options = {}) {
  const text = String(question || "");
  if (isOptionalApplicationQuestion(element, text)) {
    return false;
  }

  return (
    isQuestionControlRequired(element, text) ||
    isTikTokAuthorizationModuleQuestion(element, text) ||
    isValidationBlockedControl(element) ||
    (Boolean(options.includeUnmarked) && isApplicationFormControl(element))
  );
}

function hasVisibleApplicationQuestionControls() {
  const controlSelector = [
    "select",
    "textarea",
    "input:not([type='hidden']):not([type='submit']):not([type='button']):not([readonly])",
    ".ud__select__selector",
    "[role='combobox']",
    "[role='radio']",
    "[aria-haspopup='listbox']",
    "[aria-haspopup='menu']"
  ].join(", ");

  return Array.from(document.querySelectorAll("[data-form-field-i18n-name]"))
    .filter((element) => isElementVisible(element))
    .some((element) =>
      Array.from(element.querySelectorAll(controlSelector))
        .some((control) => isElementVisible(control) && !isActionDisabled(control))
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

async function waitForCondition(predicate, options = {}) {
  const timeoutMs = options.timeoutMs ?? 2000;
  const intervalMs = options.intervalMs ?? 100;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return true;
    }
    await delay(intervalMs);
  }

  return Boolean(predicate());
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

// Detect target=_blank links before clicking so background.js can create, track, focus, and later
// close the application tab itself. Letting the page create it natively makes ownership and cleanup
// ambiguous, especially when the site chooses a different window.
function getBackgroundOpenableLink(element) {
  const anchor = element?.matches?.("a[target='_blank'][href]")
    ? element
    : element?.closest?.("a[target='_blank'][href]");

  if (!anchor) {
    return null;
  }

  try {
    return new URL(anchor.getAttribute("href"), window.location.href).href;
  } catch (_error) {
    return null;
  }
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

async function waitForClickable(pattern, timeoutMs = WORKFLOW_WAIT_TIMEOUT_MS, options = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (options.shouldStop?.()) {
      return null;
    }

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

  const element = await waitForClickable(pattern, options.timeoutMs, {
    shouldStop: options.shouldStop
  });

  if (!element) {
    if (options.recordMissing !== false) {
      steps.push({
        step: stepName,
        status: "missing"
      });
    }
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

function buildAlreadyAppliedActionResult(signal, steps) {
  const label = signal.body || signal.text || "You've already applied for this job. Unable to apply again.";

  steps.push({
    step: "Detect already applied notice",
    status: "detected",
    label
  });

  return {
    clicked: true,
    done: true,
    pending: false,
    alreadySubmitted: true,
    errorType: "already_applied",
    summary: label
  };
}

async function clickAndDetectSubmission(element, steps, options = {}) {
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

  const outcome = await waitForSubmissionOutcome(options.outcomeOptions);

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

  const postClickValidationErrors = getVisibleValidationErrors();
  if (postClickValidationErrors.length > 0) {
    steps.push({
      step: "Check for validation errors after submitting",
      status: "blocked",
      label: postClickValidationErrors.join("; ")
    });
    return {
      clicked: true,
      done: false,
      pending: false,
      pausedForReview: true,
      errorType: "blocked_by_validation",
      summary: `Submit was clicked, but the form reported ${postClickValidationErrors.length} validation issue(s): ${postClickValidationErrors.join("; ")}`
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

  // Some ByteDance/Formily variants reject Submit without exposing an alert, aria-invalid state, or
  // feedback-error node. Before treating the click as genuinely ambiguous, inspect only controls the
  // live DOM explicitly identifies as required (including the narrowly-scoped Work Authorization
  // module exception). This is not the broadened includeUnmarked recovery: if no concrete required
  // field is visible, the workflow still stops without another Submit click.
  const explicitRequiredAudit = auditRequiredApplicationFields({ includeUnmarked: false });
  if (explicitRequiredAudit.unanswered.length > 0) {
    const auditSummary = formatRequiredFieldAuditSummary(explicitRequiredAudit);
    steps.push({
      step: "Check for validation errors after submitting",
      status: "blocked",
      label: auditSummary
    });
    return {
      clicked: true,
      done: false,
      pending: false,
      pausedForReview: true,
      errorType: "blocked_by_validation",
      summary: `Submit was clicked, and the page still has explicit unanswered required fields. ${auditSummary}`
    };
  }

  // Clicked, and neither a success signal, an already-applied signal, nor a still-loading indicator
  // showed up within waitForSubmissionOutcome's window -- genuinely ambiguous, not a confident success.
  // Reuses pausedForReview (its downstream handling in background.js is already generic: "needs_review"
  // status, driven by whatever errorType/summary this response carries, not hardcoded essay-review
  // text) rather than silently reporting done:true on a click alone, and rather than falling through to
  // another attempt -- retrying could click an already-submitted form's Submit button a second time.
  steps.push({
    step: "Confirm application submitted",
    status: "unconfirmed"
  });
  return {
    clicked: true,
    done: false,
    pending: false,
    pausedForReview: true,
    errorType: "clicked_but_unconfirmed",
    summary:
      "Clicked final Submit, but couldn't confirm a success, already-applied, or still-loading signal afterward -- please check this application manually before assuming it went through."
  };
}

async function clickFinalSubmit(steps, options = {}) {
  window.scrollTo(0, document.body.scrollHeight);
  await delay(500);

  const siteConfig = getSiteConfig();
  const alreadyAppliedBeforeSubmitSearch = getAlreadyAppliedSignal();

  if (alreadyAppliedBeforeSubmitSearch) {
    return buildAlreadyAppliedActionResult(alreadyAppliedBeforeSubmitSearch, steps);
  }

  let alreadyAppliedDuringSubmitSearch = null;
  const element = await waitForClickable(siteConfig?.finalSubmitPattern || /^submit$/i, 4000, {
    shouldStop: () => {
      alreadyAppliedDuringSubmitSearch = getAlreadyAppliedSignal();
      return Boolean(alreadyAppliedDuringSubmitSearch);
    }
  });

  if (!element) {
    // The duplicate-application check is asynchronous. A persistent ByteDance confirm can mount
    // while waitForClickable() is looking for a Submit button, after the earlier settle check ended.
    const alreadyAppliedSignal = alreadyAppliedDuringSubmitSearch || getAlreadyAppliedSignal();

    if (alreadyAppliedSignal) {
      return buildAlreadyAppliedActionResult(alreadyAppliedSignal, steps);
    }

    if (options.recordMissing !== false) {
      steps.push({
        step: "Submit application",
        status: "missing"
      });
    }
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
  const alreadyAppliedSignal = getAlreadyAppliedSignal();

  if (alreadyAppliedSignal) {
    return buildAlreadyAppliedActionResult(alreadyAppliedSignal, steps);
  }

  const primaryButton = findPrimaryActionButton(siteConfig);

  if (!primaryButton) {
    // TikTok/ByteDance use separate controls, so an intermediate page normally has Continue but no
    // Submit. Treat this first lookup as a probe and only record a missing Submit if Continue is also
    // absent; otherwise the activity log would show a false failure on every normal intermediate step.
    const submitResult = await clickFinalSubmit(steps, { recordMissing: false });

    if (
      submitResult.done ||
      submitResult.pending ||
      submitResult.pausedForReview ||
      submitResult.errorType === "blocked_by_validation"
    ) {
      return submitResult;
    }

    let alreadyAppliedDuringContinueSearch = null;
    const continued = await clickAction(
      siteConfig?.continuePattern || /^continue$/i,
      "Continue application step",
      steps,
      {
        scrollBottom: true,
        timeoutMs: 5000,
        recordMissing: false,
        shouldStop: () => {
          alreadyAppliedDuringContinueSearch = getAlreadyAppliedSignal();
          return Boolean(alreadyAppliedDuringContinueSearch);
        }
      }
    );

    if (!continued) {
      // Repeat the status check after the Continue search too. Without this, a dialog that mounted
      // during either action lookup was incorrectly reported as a missing Submit button.
      const alreadyAppliedSignal = alreadyAppliedDuringContinueSearch || getAlreadyAppliedSignal();

      if (alreadyAppliedSignal) {
        return buildAlreadyAppliedActionResult(alreadyAppliedSignal, steps);
      }

      steps.push({
        step: "Continue application step",
        status: "missing"
      });
      steps.push({
        step: "Submit application",
        status: "missing"
      });
    }

    const continuationValidationErrors = continued ? getVisibleValidationErrors() : [];
    if (continuationValidationErrors.length > 0) {
      steps.push({
        step: "Check for validation errors after continuing",
        status: "blocked",
        label: continuationValidationErrors.join("; ")
      });
      return {
        clicked: true,
        done: false,
        pending: false,
        errorType: "blocked_by_validation",
        summary: `Continue was clicked, but ${continuationValidationErrors.length} required validation issue(s) still block this step: ${continuationValidationErrors.join("; ")}`
      };
    }

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

  const continuationValidationErrors = getVisibleValidationErrors();
  if (continuationValidationErrors.length > 0) {
    steps.push({
      step: "Check for validation errors after continuing",
      status: "blocked",
      label: continuationValidationErrors.join("; ")
    });
    return {
      clicked: true,
      done: false,
      pending: false,
      errorType: "blocked_by_validation",
      summary: `Continue was clicked, but ${continuationValidationErrors.length} required validation issue(s) still block this step: ${continuationValidationErrors.join("; ")}`
    };
  }

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
      return /\b(visa|sponsor|sponsorship|work authorization)\b/.test(text) &&
        isQuestionControlRequired(element, text);
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
    /\beligible to work\b/.test(lower) ||
    /\b(?:right|permission)[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work\b/.test(lower) ||
    /\bvalid work authori[sz]ation\b/.test(lower) ||
    /\bwork in the (?:us|u\.s\.|united states)\b/.test(lower)
  );
}

function isCategoricalWorkAuthorizationStatusQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return /\bright[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work\s+status\b/.test(lower);
}

function isVisaSponsorshipQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return (
    /\bvisa sponsorship\b/.test(lower) ||
    /\brequire sponsorship\b/.test(lower) ||
    /\bsponsorship for employment\b/.test(lower) ||
    /\bvisa transfer\b/.test(lower) ||
    /\b(?:employment|work) visa\b/.test(lower) ||
    /\bimmigration (?:support|assistance)\b/.test(lower) ||
    /\b(?:require|need|seek)\b.{0,50}\b(?:sponsor(?:ship)?|work visa|immigration support)\b/.test(lower) ||
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

function isCriminalHistoryQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return (
    /\bcriminal (?:history|record)\b/.test(lower) ||
    /\bcriminal offen[cs]e\b/.test(lower) ||
    /\b(?:convicted|conviction|felony|misdemeanor)\b/.test(lower) ||
    /\b(?:ever|previously)\b.{0,50}\b(?:arrested|charged)\b/.test(lower) ||
    /\b(?:found|pleaded|pled) guilty\b/.test(lower)
  );
}

function isRaceEthnicityQuestion(text) {
  return /\b(?:race|ethnicity|ethnic origin)\b/i.test(text || "");
}

function isVeteranStatusQuestion(text) {
  return /\bveteran\b/i.test(text || "");
}

function isDisabilityStatusQuestion(text) {
  return /\bdisabilit(?:y|ies)\b/i.test(text || "");
}

function isStartDateQuestion(text) {
  return /\b(?:earliest|available|availability|start)\b.*\b(?:date|start)\b|\bwhen can you start\b/i.test(text || "");
}

function isApplicationChoiceQuestion(text) {
  const normalized = normalizeText(text || "");
  return (
    normalized.length <= 500 &&
    (normalized.includes("?") ||
      isWorkAuthorizationQuestion(normalized) ||
      isVisaSponsorshipQuestion(normalized) ||
      isAgeEligibilityQuestion(normalized) ||
      isPriorAppleEmploymentQuestion(normalized) ||
      isPriorAppleContractorQuestion(normalized) ||
      isCriminalHistoryQuestion(normalized) ||
      isRaceEthnicityQuestion(normalized) ||
      isVeteranStatusQuestion(normalized) ||
      isDisabilityStatusQuestion(normalized) ||
      isStartDateQuestion(normalized))
  );
}

function isAgentQuestionExcluded(element) {
  // Apple identifies this resume-parsing satisfaction survey with a stable section id and does not
  // mark either radio as required. Answering it cannot unblock Continue, so sending it to the LLM is
  // pure API spend and can also overwrite feedback the candidate intentionally left unanswered.
  return Boolean(element?.closest?.("#apply-parsing-feedback"));
}

function getApplicationControlQuestionLabel(element) {
  const dataField = element.closest?.("[data-form-field-i18n-name]");
  const candidates = [dataField?.getAttribute("data-form-field-i18n-name"), getElementLabel(element)];
  let ancestor = element.parentElement;

  for (let depth = 0; ancestor && depth < 4; depth += 1) {
    candidates.push(normalizeText(ancestor.innerText || ""));
    ancestor = ancestor.parentElement;
  }

  return candidates
    .map((candidate) => normalizeText(candidate || ""))
    .filter((candidate) => isApplicationChoiceQuestion(candidate))
    .sort((left, right) => left.length - right.length)[0] || getElementLabel(element);
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

function findOpenTextQuestionField(options = {}) {
  const fields = Array.from(
    document.querySelectorAll(
      [
        "textarea",
        "input:not([type])",
        "input[type='text']",
        "input[type='email']",
        "input[type='tel']",
        "input[type='url']",
        "input[type='number']",
        "input[type='date']",
        "input[type='month']"
      ].join(", ")
    )
  )
    .filter((element) => isElementVisible(element))
    .filter((element) => !isActionDisabled(element))
    .filter((element) => !element.readOnly && element.getAttribute?.("readonly") === null)
    .filter((element) => !isAgentQuestionExcluded(element))
    .filter((element) => !(element.value || "").trim());

  return fields.find((element) => {
    const label = getElementLabel(element);
    return shouldAgentAnswerRequiredControl(element, label, options);
  }) || null;
}

function getQuestionContainers() {
  return Array.from(document.querySelectorAll("fieldset, section, div, li"))
    .filter((element) => isElementVisible(element))
    .filter((element) => isQuestionControlRequired(element, normalizeText(element.innerText || "")))
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
  const selectorPattern = ".ud__select__selector, [role='combobox'], [aria-haspopup='listbox']";
  const inputPattern = "input[role='combobox'], input[readonly]";
  // closest("..., div") can resolve to a custom-select trigger itself. Reading descendants only then
  // misses an already-selected value rendered directly on that trigger (the ByteDance phone prefix
  // shows "+1" this way), making recovery reopen and overwrite a completed profile control.
  const selector = container?.matches?.(selectorPattern)
    ? container
    : container?.querySelector?.(selectorPattern);
  const input = container?.matches?.(inputPattern)
    ? container
    : container?.querySelector?.(inputPattern);

  return normalizeText(
    `${selector?.innerText || ""} ${input?.value || ""} ${selector?.getAttribute("aria-label") || ""}`
  );
}

function hasMeaningfulSelectedDropdownValue(container) {
  const displayedValue = getSelectedDropdownText(container);
  return Boolean(displayedValue) && !/^(?:select|choose)(?: an?)?(?: option| answer)?$/i.test(displayedValue);
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
  const alreadyAppliedBeforeQuestions = getAlreadyAppliedSignal();

  if (alreadyAppliedBeforeQuestions) {
    return {
      answeredAny: false,
      requiredCount: 0,
      answeredCount: 0,
      alreadyAppliedSignal: alreadyAppliedBeforeQuestions
    };
  }

  const tikTokFields = Array.from(document.querySelectorAll("[data-form-field-i18n-name]"))
    .filter((element) => isElementVisible(element))
    .map((element) => ({
      element,
      question: normalizeText(element.getAttribute("data-form-field-i18n-name") || element.innerText || "")
    }))
    .filter(({ element, question }) =>
      (isWorkAuthorizationQuestion(question) || isVisaSponsorshipQuestion(question)) &&
      !isCategoricalWorkAuthorizationStatusQuestion(question) &&
      shouldAnswerTikTokAuthorizationField(element, question)
    );

  if (tikTokFields.length) {
    let answeredCount = 0;

    for (const { element, question } of tikTokFields) {
      const alreadyAppliedSignal = getAlreadyAppliedSignal();

      if (alreadyAppliedSignal) {
        return {
          answeredAny: answeredCount > 0,
          requiredCount: tikTokFields.length,
          answeredCount,
          alreadyAppliedSignal
        };
      }

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
      answeredCount,
      alreadyAppliedSignal: getAlreadyAppliedSignal()
    };
  }

  const containers = getQuestionContainers();
  const questionRules = [
    {
      matcher: (question) =>
        isWorkAuthorizationQuestion(question) && !isCategoricalWorkAuthorizationStatusQuestion(question),
      answer: answerYesQuestion,
      stepName: "Answer work authorization"
    },
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
    const alreadyAppliedSignal = getAlreadyAppliedSignal();

    if (alreadyAppliedSignal) {
      return {
        answeredAny: answeredCount > 0,
        requiredCount,
        answeredCount,
        alreadyAppliedSignal
      };
    }

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
    answeredCount,
    alreadyAppliedSignal: getAlreadyAppliedSignal()
  };
}

function getAnswerOptionLabel(option) {
  if (option.tagName?.toLowerCase() === "input") {
    const ownLabel = Array.from(option.labels || []).map((label) => normalizeText(label.innerText || "")).find(Boolean);
    return ownLabel || normalizeText(option.value || option.getAttribute("aria-label") || getElementLabel(option));
  }
  return getActionLabel(option) || getElementLabel(option);
}

function isAnswerOptionSelected(option) {
  const nestedInput = option.querySelector?.("input[type='radio'], input[type='checkbox']");
  return (
    Boolean(option.checked) ||
    Boolean(nestedInput?.checked) ||
    option.getAttribute("aria-checked") === "true" ||
    option.getAttribute("aria-pressed") === "true" ||
    option.getAttribute("aria-selected") === "true" ||
    /\b(selected|active|is-selected|is-active|checked)\b/i.test(option.className || "")
  );
}

function isAgentChoiceConfirmed(kind, option, displayedText, wantedValue) {
  return isAnswerOptionSelected(option) ||
    (kind === "custom_dropdown" && normalizeText(displayedText).toLowerCase().includes(normalizeText(wantedValue).toLowerCase()));
}

function getAgentOptionControls(container) {
  const radios = Array.from(
    container.querySelectorAll("input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']")
  )
    .filter((element) => isElementVisible(element) && !isActionDisabled(element));
  if (radios.length >= 1 && radios.length <= 12) {
    return radios;
  }

  const buttons = Array.from(container.querySelectorAll("button, [role='button']"))
    .filter((element) => isElementVisible(element) && !isActionDisabled(element))
    .filter((element) => !element.closest("[role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='menu']"));

  if (buttons.some(isNonAnswerAction)) {
    return [];
  }

  return buttons.filter((element) => {
    const label = getAnswerOptionLabel(element);
    return label.length > 0 && label.length <= 80;
  });
}

function isPlaceholderOption(option) {
  const text = normalizeText(`${option?.textContent || ""} ${option?.value || ""}`);
  return !option || option.disabled || !String(option.value || "").trim() || /^(?:select|choose)(?: an?)?(?: option| date)?/i.test(text);
}

function findAgentNativeSelect(handled = new Set(), options = {}) {
  return Array.from(document.querySelectorAll("select"))
    .filter((element) => isElementVisible(element) && !isActionDisabled(element))
    .filter((element) => !isAgentQuestionExcluded(element))
    .find((element) => {
      const label = getApplicationControlQuestionLabel(element);
      const selected = element.options?.[element.selectedIndex];
      return !handled.has(`select::${label}`) && shouldAgentAnswerRequiredControl(element, label, options) &&
        isPlaceholderOption(selected);
    }) || null;
}

function findAgentOptionGroup(handled = new Set(), agentOptions = {}) {
  const candidates = Array.from(document.querySelectorAll("fieldset, section, div, li"))
    .filter((element) => isElementVisible(element))
    .filter((element) => !isAgentQuestionExcluded(element))
    .map((element) => ({
      element,
      text: getApplicationControlQuestionLabel(element),
      options: getAgentOptionControls(element)
    }))
    .filter(({ element, text, options }) =>
      shouldAgentAnswerRequiredControl(element, text, agentOptions) && options.length >= 1 && options.length <= 12
    )
    .filter(({ options }) => !options.some(isAnswerOptionSelected));
  const smallest = candidates.filter(
    ({ element }) => !candidates.some((other) => other.element !== element && element.contains(other.element))
  );
  return smallest
    .filter(({ text }) => !handled.has(`option_group::${text}`))
    .filter(({ text }) => typeof agentOptions.questionFilter !== "function" || agentOptions.questionFilter(text))
    .sort((left, right) => left.text.length - right.text.length)[0] || null;
}

function findAgentCustomDropdown(handled = new Set(), options = {}) {
  const selector = ".ud__select__selector, [role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='menu']";
  const all = Array.from(document.querySelectorAll(selector))
    .filter((element) => isElementVisible(element) && !isActionDisabled(element))
    .filter((element) => !isAgentQuestionExcluded(element) && !isNonAnswerAction(element));
  const topLevel = all.filter((element) => !all.some((other) => other !== element && other.contains(element)));

  return topLevel.find((element) => {
    const label = getApplicationControlQuestionLabel(element);
    const container = getAgentFieldContainer(element);
    return !handled.has(`custom_dropdown::${label}`) && shouldAgentAnswerRequiredControl(element, label, options) &&
      !hasMeaningfulSelectedDropdownValue(container);
  }) || null;
}

const REQUIRED_FIELD_AUDIT_SELECTOR = [
  "select",
  "textarea",
  "[contenteditable='true']",
  "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='reset']):not([type='file'])",
  ".ud__select__selector",
  "[role='combobox']",
  "[aria-haspopup='listbox']",
  "[aria-haspopup='menu']",
  "[role='radio']",
  "[role='checkbox']"
].join(", ");

function isCustomDropdownControl(element) {
  return Boolean(
    element?.matches?.(
      ".ud__select__selector, [role='combobox'], [aria-haspopup='listbox'], [aria-haspopup='menu']"
    )
  );
}

function getRequiredFieldAuditControls() {
  const controls = Array.from(document.querySelectorAll(REQUIRED_FIELD_AUDIT_SELECTOR))
    .filter((element) => isElementVisible(element) && !isActionDisabled(element))
    .filter((element) => !isAgentQuestionExcluded(element))
    .filter((element) => !isCustomDropdownControl(element) || !isNonAnswerAction(element));
  const customDropdowns = controls.filter(isCustomDropdownControl);
  const topLevelCustomDropdowns = customDropdowns.filter(
    (element) => !customDropdowns.some((other) => other !== element && other.contains?.(element))
  );

  return controls.filter((element) => !isCustomDropdownControl(element) || topLevelCustomDropdowns.includes(element));
}

function getRequiredFieldAuditKind(element) {
  const tagName = String(element?.tagName || "").toLowerCase();
  const type = String(element?.getAttribute?.("type") || element?.type || "").toLowerCase();
  const role = String(element?.getAttribute?.("role") || "").toLowerCase();

  if (tagName === "select") return "select";
  if (isCustomDropdownControl(element)) return "custom_dropdown";
  if (type === "radio" || type === "checkbox" || role === "radio" || role === "checkbox") {
    return "option_group";
  }
  if (tagName === "textarea" || tagName === "input" || element?.isContentEditable) return "open_text";
  return "unsupported";
}

function getRequiredFieldAuditGroup(element, kind) {
  if (kind !== "option_group") {
    return kind === "custom_dropdown" ? getAgentFieldContainer(element) : element;
  }

  return element?.closest?.(
    "[data-form-field-i18n-name], [data-form-field-id], .ud-formily-item, fieldset, [role='radiogroup'], [role='group']"
  ) || element;
}

function isRequiredFieldAuditControlAnswered(element, kind, group) {
  if (kind === "select") {
    return !isPlaceholderOption(element.options?.[element.selectedIndex]);
  }

  if (kind === "custom_dropdown") {
    return hasMeaningfulSelectedDropdownValue(group || element);
  }

  if (kind === "option_group") {
    const options = Array.from(
      group?.querySelectorAll?.(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"
      ) || [element]
    );
    return options.some(isAnswerOptionSelected);
  }

  if (element?.isContentEditable) {
    return Boolean(normalizeText(element.innerText || element.textContent || ""));
  }

  return Boolean(String(element?.value || "").trim());
}

function auditRequiredApplicationFields(options = {}) {
  const records = [];
  const optionGroups = new Set();

  for (const element of getRequiredFieldAuditControls()) {
    const kind = getRequiredFieldAuditKind(element);
    const group = getRequiredFieldAuditGroup(element, kind);
    if (kind === "option_group" && optionGroups.has(group)) {
      continue;
    }
    if (kind === "option_group") {
      optionGroups.add(group);
    }

    const label = getApplicationControlQuestionLabel(element);
    if (!shouldAgentAnswerRequiredControl(element, label, options)) {
      continue;
    }

    const answered = isRequiredFieldAuditControlAnswered(element, kind, group);
    records.push({
      element,
      group,
      kind,
      label,
      answered,
      answerable:
        kind === "select" ||
        kind === "custom_dropdown" ||
        kind === "open_text" ||
        (kind === "option_group" && /\b(?:gender|race|ethnicity|veteran|disabilit(?:y|ies))\b/i.test(label))
    });
  }

  const unanswered = records.filter((record) => !record.answered);
  return {
    totalRequired: records.length,
    answeredCount: records.length - unanswered.length,
    unanswered,
    answerableUnanswered: unanswered.filter((record) => record.answerable),
    unsupportedUnanswered: unanswered.filter((record) => !record.answerable)
  };
}

function getRequiredFieldAuditFingerprint(audit) {
  return [...new Set((audit?.unanswered || []).map((record) =>
    `${record.kind || "unknown"}::${normalizeText(record.label || "unlabeled field").toLowerCase()}`
  ))]
    .sort()
    .join("|");
}

function formatRequiredFieldAuditSummary(audit) {
  if (audit.unanswered.length === 0) {
    return audit.totalRequired > 0
      ? `${audit.totalRequired} required field(s) are answered and verified.`
      : "No unanswered required fields were found.";
  }

  const labels = [...new Set(audit.unanswered.map((record) => record.label).filter(Boolean))].slice(0, 4);
  const remaining = audit.unanswered.length - labels.length;
  const labelSummary = labels.length
    ? `: ${labels.join("; ")}${remaining > 0 ? `; and ${remaining} more` : ""}`
    : "";
  return `${audit.unanswered.length} of ${audit.totalRequired} required field(s) remain unanswered${labelSummary}.`;
}

function readAgentChoiceDescriptor(handled = new Set(), options = {}) {
  const nativeSelect = findAgentNativeSelect(handled, options);
  if (nativeSelect) {
    return {
      kind: nativeSelect.multiple ? "multi_select" : "select",
      element: nativeSelect,
      label: getApplicationControlQuestionLabel(nativeSelect),
      options: Array.from(nativeSelect.options || [])
        .filter((option) => !isPlaceholderOption(option))
        .map((option) => normalizeText(option.textContent || option.value || ""))
        .filter(Boolean)
    };
  }

  const optionGroup = findAgentOptionGroup(handled, {
    ...options,
    questionFilter: (text) => /\b(?:gender|race|ethnicity|veteran|disabilit(?:y|ies))\b/i.test(text)
  });
  if (optionGroup) {
    const supportsMultiple = optionGroup.options.every((option) =>
      option.matches?.("input[type='checkbox'], [role='checkbox']") ||
      Boolean(option.querySelector?.("input[type='checkbox'], [role='checkbox']"))
    );
    return {
      kind: supportsMultiple ? "checkbox_group" : "option_group",
      element: optionGroup.element,
      container: optionGroup.element,
      label: optionGroup.text,
      optionElements: optionGroup.options,
      options: optionGroup.options.map(getAnswerOptionLabel)
    };
  }

  const customDropdown = findAgentCustomDropdown(handled, options);
  if (customDropdown) {
    const label = getApplicationControlQuestionLabel(customDropdown);
    return {
      kind: /\bselect all|all that apply|multiple\b/i.test(label) ? "custom_multi_select" : "custom_dropdown",
      element: customDropdown,
      container: getAgentFieldContainer(customDropdown),
      label,
      options: []
    };
  }

  return null;
}

function getVisibleAgentDropdownOptions(root = document) {
  return Array.from(
    root.querySelectorAll?.(".ud__select__list__item, [role='option'], [role='menuitem']") || []
  ).filter((element) => isElementVisible(element) && !isActionDisabled(element));
}

function getAgentDropdownControlledScopes(control) {
  const sources = [
    control,
    ...Array.from(control?.querySelectorAll?.("[aria-controls], [aria-owns]") || [])
  ];
  const ids = sources.flatMap((element) =>
    [element?.getAttribute?.("aria-controls"), element?.getAttribute?.("aria-owns")]
      .filter(Boolean)
      .flatMap((value) => String(value).split(/\s+/))
  );

  return [...new Set(ids)]
    .map((id) => document.getElementById(id))
    .filter(Boolean);
}

async function openAndReadAgentDropdownOptions(control) {
  const before = new Set(getVisibleAgentDropdownOptions());
  control.scrollIntoView({ block: "center" });
  await delay(150);
  control.click();

  const deadline = Date.now() + 4000;
  let lastSignature = "";
  let stableChecks = 0;
  let bestCandidates = [];

  while (Date.now() < deadline) {
    const visible = getVisibleAgentDropdownOptions();
    const revealed = visible.filter((option) => !before.has(option));
    const controlled = getAgentDropdownControlledScopes(control)
      .flatMap((scope) => getVisibleAgentDropdownOptions(scope));
    const candidates = [...new Set(controlled.length ? controlled : revealed.length ? revealed : visible)];
    const signature = candidates.map(getAnswerOptionLabel).filter(Boolean).join("\n");

    if (candidates.length > 0) {
      bestCandidates = candidates;
      if (signature === lastSignature) {
        stableChecks += 1;
        if (stableChecks >= 2) {
          return bestCandidates;
        }
      } else {
        lastSignature = signature;
        stableChecks = 0;
      }
    }
    await delay(150);
  }

  return bestCandidates;
}

async function requestApplicationQuestionDecision(descriptor, options = descriptor.options) {
  const response = await chrome.runtime
    .sendMessage({
      type: "APPLE_CAREERS_RESOLVE_APPLICATION_QUESTION",
      questionText: descriptor.label,
      options,
      fieldKind: descriptor.kind,
      jobId: getJobId(),
      pageTitle: document.title,
      siteLabel: getSiteConfig()?.label || window.location.hostname
    })
    .catch((error) => ({ ok: false, error: error?.message }));

  return response?.ok ? response.data : null;
}

function setNativeFormValue(element, value) {
  const prototype = element.tagName?.toLowerCase() === "textarea"
    ? window.HTMLTextAreaElement?.prototype
    : element.tagName?.toLowerCase() === "select"
      ? window.HTMLSelectElement?.prototype
      : window.HTMLInputElement?.prototype;
  const setter = prototype && Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) {
    setter.call(element, value);
  } else {
    element.value = value;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function setNativeSelectValues(element, wantedValues) {
  const values = Array.isArray(wantedValues) ? wantedValues : [wantedValues];
  const options = Array.from(element.options || []);
  const matches = values.map((wantedValue) =>
    options.find((option) => normalizeText(option.textContent || option.value || "").toLowerCase() === wantedValue.toLowerCase())
  );
  if (matches.some((option) => !option) || (matches.length > 1 && !element.multiple)) {
    return false;
  }
  if (matches.length === 1) {
    setNativeFormValue(element, matches[0].value);
    return true;
  }

  const selectedSetter = Object.getOwnPropertyDescriptor(window.HTMLOptionElement?.prototype || {}, "selected")?.set;
  for (const option of options) {
    const selected = matches.includes(option);
    if (selectedSetter) selectedSetter.call(option, selected);
    else option.selected = selected;
  }
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

async function answerAdditionalChoiceQuestions(steps, options = {}) {
  const handled = new Set();
  let answeredCount = 0;

  for (let iteration = 0; iteration < 20; iteration += 1) {
    const alreadyAppliedSignal = getAlreadyAppliedSignal();
    if (alreadyAppliedSignal) {
      return { answeredCount, incomplete: false, alreadyAppliedSignal };
    }

    const descriptor = readAgentChoiceDescriptor(handled, options);
    if (!descriptor) {
      return { answeredCount, incomplete: false, alreadyAppliedSignal: null };
    }

    const key = `${descriptor.kind}::${descriptor.label}`;
    if (handled.has(key)) {
      return { answeredCount, incomplete: false, alreadyAppliedSignal: null };
    }
    handled.add(key);
    if (descriptor.kind === "multi_select") handled.add(`select::${descriptor.label}`);
    if (descriptor.kind === "custom_multi_select") handled.add(`custom_dropdown::${descriptor.label}`);
    if (["option_group", "checkbox_group"].includes(descriptor.kind)) handled.add(`option_group::${descriptor.label}`);

    let optionElements = descriptor.optionElements || [];
    let optionLabels = descriptor.options;
    if (["custom_dropdown", "custom_multi_select"].includes(descriptor.kind)) {
      optionElements = await openAndReadAgentDropdownOptions(descriptor.element);
      optionLabels = optionElements.map(getAnswerOptionLabel);
    }

    const decision = await requestApplicationQuestionDecision(descriptor, optionLabels);
    const wantedValues = decision?.action === "choose_options"
      ? (Array.isArray(decision.value) ? decision.value : []).map((value) => normalizeText(value)).filter(Boolean)
      : decision?.action === "choose_option"
        ? [normalizeText(decision.value || "")].filter(Boolean)
        : [];
    const stepName = `${decision?.sensitive ? "Saved profile answer" : "Question agent"}: ${descriptor.label}`;

    if (wantedValues.length === 0) {
      steps.push({ step: stepName, status: "missing", label: "No safe offered option was available." });
      return { answeredCount, incomplete: true, alreadyAppliedSignal: null };
    }

    let confirmed = false;
    if (["select", "multi_select"].includes(descriptor.kind)) {
      if (setNativeSelectValues(descriptor.element, wantedValues)) {
        confirmed = await waitForCondition(
          () => wantedValues.every((wantedValue) =>
            Array.from(descriptor.element.selectedOptions || []).some(
              (option) => normalizeText(option.textContent || option.value || "").toLowerCase() === wantedValue.toLowerCase()
            )
          )
        );
      }
    } else if (["option_group", "checkbox_group"].includes(descriptor.kind)) {
      const matched = wantedValues.map((wantedValue) =>
        optionElements.find((candidate) => getAnswerOptionLabel(candidate).toLowerCase() === wantedValue.toLowerCase())
      );
      if (!matched.some((option) => !option) && (matched.length === 1 || descriptor.kind === "checkbox_group")) {
        for (const option of matched) {
          option.scrollIntoView({ block: "nearest" });
          option.click();
        }
        confirmed = await waitForCondition(() => matched.every(isAnswerOptionSelected));
      }
    } else {
      confirmed = true;
      for (let valueIndex = 0; valueIndex < wantedValues.length; valueIndex += 1) {
        const wantedValue = wantedValues[valueIndex];
        const currentOptions = valueIndex === 0 ? optionElements : await openAndReadAgentDropdownOptions(descriptor.element);
        const option = currentOptions.find(
          (candidate) => getAnswerOptionLabel(candidate).toLowerCase() === wantedValue.toLowerCase()
        );
        if (!option) {
          confirmed = false;
          break;
        }
        option.scrollIntoView({ block: "nearest" });
        option.click();
        const selected = await waitForCondition(() => {
          const displayed = normalizeText(
            `${descriptor.element.innerText || ""} ${descriptor.element.value || ""} ${getSelectedDropdownText(descriptor.container || descriptor.element)}`
          );
          return isAgentChoiceConfirmed(descriptor.kind, option, displayed, wantedValue);
        });
        if (!selected) {
          confirmed = false;
          break;
        }
      }
    }

    steps.push({
      step: stepName,
      status: confirmed ? "selected" : "unverified",
      label: confirmed
        ? decision?.sensitive ? "Answered from saved profile and verified." : "Agent selected an offered option and verified it."
        : "Could not verify the selected offered option."
    });

    if (!confirmed) {
      return { answeredCount, incomplete: true, alreadyAppliedSignal: null };
    }

    answeredCount += 1;
    await delay(300);
  }

  return { answeredCount, incomplete: true, alreadyAppliedSignal: null };
}

async function answerOpenTextQuestion(steps, options = {}) {
  const field = findOpenTextQuestionField(options);

  if (!field) {
    return { answered: false, incomplete: false };
  }

  const label = getElementLabel(field);
  const stepName = `Draft answer: ${label}`;

  const response = await chrome.runtime
    .sendMessage({
      type: "APPLE_CAREERS_RESOLVE_APPLICATION_QUESTION",
      questionText: label,
      options: [],
      fieldKind: field.tagName?.toLowerCase() === "textarea" ? "textarea" : "text",
      jobId: getJobId(),
      pageTitle: document.title,
      siteLabel: getSiteConfig()?.label || window.location.hostname
    })
    .catch((error) => ({ ok: false, error: error?.message }));

  const answer = response?.ok && response.data?.action === "answer_text"
    ? normalizeText(response.data.value || "")
    : "";

  if (!answer) {
    steps.push({
      step: stepName,
      status: "skipped",
      label: response?.error || "LLM answer generation is not available."
    });
    return { answered: false, incomplete: true, questionText: label };
  }

  field.focus();
  setNativeFormValue(field, answer);
  field.scrollIntoView({ block: "center" });
  const confirmed = await waitForCondition(() => normalizeText(field.value || "") === answer);
  const wordCount = answer.trim().split(/\s+/).filter(Boolean).length;

  steps.push({
    step: stepName,
    status: confirmed ? "filled" : "unverified",
    label: confirmed
      ? `Question answered with ${wordCount} words and verified.`
      : "The answer did not remain in the field after input."
  });

  return { answered: confirmed, incomplete: !confirmed, questionText: label };
}

async function answerOpenTextQuestions(steps, options = {}) {
  let answeredCount = 0;

  for (let iteration = 0; iteration < 10; iteration += 1) {
    const result = await answerOpenTextQuestion(steps, options);
    if (result.incomplete) {
      return { answeredCount, incomplete: true, questionText: result.questionText };
    }
    if (!result.answered) {
      return { answeredCount, incomplete: false, questionText: null };
    }
    answeredCount += 1;
    await delay(250);
  }

  return { answeredCount, incomplete: true, questionText: "open-text questions" };
}

async function answerRequiredQuestionsWithAgent(steps, options = {}) {
  const choiceResult = await answerAdditionalChoiceQuestions(steps, options);

  if (choiceResult.alreadyAppliedSignal) {
    return {
      answeredCount: choiceResult.answeredCount,
      incomplete: false,
      alreadyAppliedSignal: choiceResult.alreadyAppliedSignal,
      questionText: null
    };
  }

  if (choiceResult.incomplete) {
    return {
      answeredCount: choiceResult.answeredCount,
      incomplete: true,
      alreadyAppliedSignal: null,
      questionText: "one of the required offered-answer fields"
    };
  }

  const openTextResult = await answerOpenTextQuestions(steps, options);
  return {
    answeredCount: choiceResult.answeredCount + openTextResult.answeredCount,
    incomplete: openTextResult.incomplete,
    alreadyAppliedSignal: null,
    questionText: openTextResult.questionText
  };
}

async function resolveRequiredFieldAudit(steps, options = {}) {
  const before = auditRequiredApplicationFields(options);
  const recoveryFingerprint = getRequiredFieldAuditFingerprint(before);
  let agentResult = {
    answeredCount: 0,
    incomplete: false,
    alreadyAppliedSignal: null,
    questionText: null
  };

  // A framework that clears the same widget after every attempted answer can otherwise consume one
  // LLM call per workflow iteration without moving forward. The service worker carries this compact
  // label/kind fingerprint across page reloads, while DOM authority and the stop decision stay here.
  if (
    recoveryFingerprint &&
    options.previousRecoveryFingerprint &&
    recoveryFingerprint === options.previousRecoveryFingerprint
  ) {
    const summary = `The same required field(s) remained unanswered after the previous recovery: ${formatRequiredFieldAuditSummary(before)}`;
    steps.push({
      step: "Audit required fields",
      status: "blocked",
      label: summary
    });
    return {
      ...agentResult,
      incomplete: true,
      noProgress: true,
      recoveryFingerprint,
      questionText: before.unanswered[0]?.label || null,
      audit: before
    };
  }

  // Optional/voluntary questions never enter the audit. The LLM is only awakened when the fresh DOM
  // inventory contains an unanswered required field in one of the two supported formats: open text
  // or dropdown. Unknown radio/checkbox groups are reported as unresolved rather than guessed.
  if (before.answerableUnanswered.length > 0) {
    agentResult = await answerRequiredQuestionsWithAgent(steps, options);
  }

  if (agentResult.alreadyAppliedSignal) {
    return {
      ...agentResult,
      recoveryFingerprint,
      audit: before
    };
  }

  // Do not carry element references across the agent action. Framework-driven forms commonly
  // replace the field node after input, so this is a full fresh read of the live page.
  const after = auditRequiredApplicationFields(options);
  const incomplete = after.unanswered.length > 0;

  if (incomplete) {
    steps.push({
      step: "Audit required fields",
      status: "blocked",
      label: formatRequiredFieldAuditSummary(after)
    });
  }

  return {
    answeredCount: agentResult.answeredCount,
    incomplete,
    alreadyAppliedSignal: null,
    noProgress: false,
    recoveryFingerprint,
    questionText: after.unanswered[0]?.label || agentResult.questionText,
    audit: after
  };
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

function buildAlreadyAppliedStepResult(signal, priorSteps = []) {
  const label = signal.body || signal.text || "You've already applied for this job. Unable to apply again.";

  return buildStepResult({
    clicked: true,
    done: true,
    alreadySubmitted: true,
    errorType: "already_applied",
    steps: [
      ...priorSteps,
      {
        step: "Detect already applied notice",
        status: "detected",
        label
      }
    ],
    summary: label
  });
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
  const minimumWaitMs = options.minimumWaitMs ?? 0;
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableCount = 0;

  const countInteractiveElements = () =>
    document.querySelectorAll("[data-form-field-i18n-name], select, input, textarea, button, [role='button']")
      .length;

  while (Date.now() < deadline) {
    const alreadyAppliedSignal = getAlreadyAppliedSignal();

    if (alreadyAppliedSignal) {
      return { alreadyAppliedSignal };
    }

    const currentCount = countInteractiveElements();

    if (currentCount > 0 && currentCount === lastCount) {
      stableCount += 1;
      if (stableCount >= stableChecksRequired && Date.now() - startedAt >= minimumWaitMs) {
        return { alreadyAppliedSignal: null };
      }
    } else {
      stableCount = 0;
    }

    lastCount = currentCount;
    await delay(intervalMs);
  }

  return { alreadyAppliedSignal: getAlreadyAppliedSignal() };
}

async function runApplicationWorkflowStep(options = {}) {
  const steps = [];
  const siteConfig = getSiteConfig();
  const currentUrl = getCurrentUrl();
  const submissionAttemptCount = Math.max(0, Number(options.submissionAttemptCount) || 0);
  const validationRecoveryAttempts = Math.max(0, Number(options.validationRecoveryAttempts) || 0);
  const previousValidationRecoveryFingerprint = normalizeText(String(options.previousValidationRecoveryFingerprint || ""));
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

  // ByteDance can leave the job detail URL unchanged and show its duplicate-application failure in
  // a modal after Apply is clicked. This guard must run before the detail/application-page split;
  // otherwise the detail branch sees the still-present Apply control and clicks it again without ever
  // consulting the modal detectors below.
  const alreadyAppliedOnLoad = getAlreadyAppliedSignal();

  if (alreadyAppliedOnLoad) {
    return buildAlreadyAppliedStepResult(alreadyAppliedOnLoad);
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

    const backgroundOpenableLink = getBackgroundOpenableLink(submitResume);

    if (backgroundOpenableLink) {
      steps.push({
        step: "Open application flow",
        status: "opening_in_workflow_tab",
        label: getActionLabel(submitResume)
      });

      return buildStepResult({
        clicked: true,
        done: false,
        steps,
        openUrlInBackgroundTab: backgroundOpenableLink,
        summary: `Opening ${getActionLabel(submitResume) || "apply action"} in an active application tab.`
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

    const alreadyAppliedAfterClick = getAlreadyAppliedSignal();

    if (alreadyAppliedAfterClick) {
      return buildAlreadyAppliedStepResult(alreadyAppliedAfterClick, steps);
    }

    return buildStepResult({
      clicked: true,
      done: false,
      steps,
      summary: `Clicked ${getActionLabel(submitResume) || "apply action"}.`
    });
  }

  // A job's submission can land on the site (and start showing a Submitted badge on this very
  // application page) even though our own bookkeeping never recorded it -- e.g. the extension was
  // reloaded mid-attempt, right as the site accepted the submission but before markLinkProcessed()/
  // saveJobRecord() ran. The next scan then re-queues this job and lands back on this same page,
  // which no longer has a working Continue/Submit action. Check for the generic Submitted signal
  // here too (already checked on the detail page) before assuming the form still needs filling out.
  const submittedOnLoad = getSubmittedSignal();

  if (submittedOnLoad) {
    return buildStepResult({
      clicked: true,
      done: true,
      alreadySubmitted: true,
      steps: [
        {
          step: "Detect already submitted",
          status: "detected",
          label: submittedOnLoad.text
        }
      ],
      summary: "Job already shows Submitted."
    });
  }

  // TikTok and ByteDance share this site config, but ByteDance can show its duplicate-application
  // dialog before the questionnaire is mounted. Do not use the questionnaire's presence to decide
  // whether to keep polling: a stable page-shell button could otherwise end this wait before the
  // delayed dialog appears, and the workflow would continue into field discovery.
  const shouldWaitForTikTokApplicationSignals = siteConfig?.id === "tiktok";
  const settleResult = await waitForApplicationFormToSettle({
    minimumWaitMs: shouldWaitForTikTokApplicationSignals ? 2500 : 0
  });

  if (settleResult.alreadyAppliedSignal) {
    return buildAlreadyAppliedStepResult(settleResult.alreadyAppliedSignal, steps);
  }

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
    (siteConfig?.finalSubmitPattern || /^submit$/i).test(getActionLabel(primaryButtonBeforeQuestions)) &&
    !hasVisibleApplicationQuestionControls();

  let answeredQuestionnaire = false;
  let answeredSponsorship = false;

  if (!isReviewAndSubmitStep) {
    const questionnaireResult = await answerQuestionnaire(steps);

    if (questionnaireResult.alreadyAppliedSignal) {
      return buildAlreadyAppliedStepResult(questionnaireResult.alreadyAppliedSignal, steps);
    }

    answeredQuestionnaire = questionnaireResult.answeredAny;

    const alreadyAppliedBeforeFallback = getAlreadyAppliedSignal();

    if (alreadyAppliedBeforeFallback) {
      return buildAlreadyAppliedStepResult(alreadyAppliedBeforeFallback, steps);
    }

    answeredSponsorship = answeredQuestionnaire ? false : clickSponsorshipAnswer(steps);

    if (answeredQuestionnaire || answeredSponsorship) {
      await delay(500);
    }

    const alreadyAppliedAfterQuestions = getAlreadyAppliedSignal();

    if (alreadyAppliedAfterQuestions) {
      return buildAlreadyAppliedStepResult(alreadyAppliedAfterQuestions, steps);
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

  if (
    !primaryActionResult.clicked &&
    !primaryActionResult.done &&
    !primaryActionResult.pending &&
    !primaryActionResult.pausedForReview
  ) {
    // A disabled/missing Continue or Submit control is another concrete stuck signal. Some Formily
    // variants do not expose required/aria-required until validation, so broaden only at this point:
    // optional/voluntary fields still lose, while blank application text/dropdown controls become
    // candidates for one bounded recovery pass.
    if (validationRecoveryAttempts >= MAX_VALIDATION_RECOVERY_ATTEMPTS) {
      return buildStepResult({
        clicked: false,
        done: false,
        pausedForReview: true,
        errorType: "validation_retry_limit",
        steps,
        summary: `No enabled Continue/Submit action was available after ${MAX_VALIDATION_RECOVERY_ATTEMPTS} required-field recovery attempts.`
      });
    }

    const stuckRecovery = await resolveRequiredFieldAudit(steps, {
      includeUnmarked: true,
      previousRecoveryFingerprint: previousValidationRecoveryFingerprint
    });

    if (stuckRecovery.alreadyAppliedSignal) {
      return buildAlreadyAppliedStepResult(stuckRecovery.alreadyAppliedSignal, steps);
    }

    if (stuckRecovery.noProgress) {
      return buildStepResult({
        clicked: false,
        done: false,
        pausedForReview: true,
        errorType: "validation_no_progress",
        steps,
        summary: "The same required fields remained unanswered after recovery, so the workflow stopped without retrying indefinitely."
      });
    }

    if (stuckRecovery.answeredCount > 0 && !stuckRecovery.incomplete) {
      return buildStepResult({
        clicked: true,
        done: false,
        validationRecoveryAttempted: true,
        validationRecoveryFingerprint: stuckRecovery.recoveryFingerprint,
        steps,
        summary: `No enabled Continue/Submit action was available; the required-field recovery answered and verified ${stuckRecovery.answeredCount} field(s). Retrying the application step.`
      });
    }

    if (stuckRecovery.incomplete) {
      return buildStepResult({
        clicked: Boolean(stuckRecovery.answeredCount),
        done: false,
        pausedForReview: true,
        errorType: "required_field_audit_failed",
        steps,
        summary: `No enabled Continue/Submit action was available. ${formatRequiredFieldAuditSummary(stuckRecovery.audit)}`
      });
    }
  }

  if (primaryActionResult.errorType === "blocked_by_validation") {
    const finalSubmitClicksThisStep = steps.filter(
      (step) => step.step === "Submit application" && step.status === "clicked"
    ).length;
    const totalFinalSubmitAttempts = submissionAttemptCount + finalSubmitClicksThisStep;

    if (finalSubmitClicksThisStep > 0 && totalFinalSubmitAttempts >= MAX_FINAL_SUBMIT_ATTEMPTS) {
      return buildStepResult({
        clicked: true,
        done: false,
        pausedForReview: true,
        errorType: "submission_retry_limit",
        steps,
        summary: `The form still reported validation errors after ${MAX_FINAL_SUBMIT_ATTEMPTS} final Submit attempts, so it was not clicked again.`
      });
    }

    if (validationRecoveryAttempts >= MAX_VALIDATION_RECOVERY_ATTEMPTS) {
      return buildStepResult({
        clicked: Boolean(primaryActionResult.clicked),
        done: false,
        pausedForReview: true,
        errorType: "validation_retry_limit",
        steps,
        summary: `Validation still blocked progress after ${MAX_VALIDATION_RECOVERY_ATTEMPTS} required-field recovery attempts.`
      });
    }

    const recoveryResult = await resolveRequiredFieldAudit(steps, {
      includeUnmarked: true,
      previousRecoveryFingerprint: previousValidationRecoveryFingerprint
    });

    if (recoveryResult.alreadyAppliedSignal) {
      return buildAlreadyAppliedStepResult(recoveryResult.alreadyAppliedSignal, steps);
    }

    if (recoveryResult.noProgress) {
      return buildStepResult({
        clicked: Boolean(primaryActionResult.clicked),
        done: false,
        pausedForReview: true,
        errorType: "validation_no_progress",
        steps,
        summary: "The same required fields remained unanswered after recovery, so the workflow stopped without submitting again."
      });
    }

    if (recoveryResult.answeredCount > 0 && !recoveryResult.incomplete) {
      await delay(400);
      return buildStepResult({
        clicked: true,
        done: false,
        validationRecoveryAttempted: true,
        validationRecoveryFingerprint: recoveryResult.recoveryFingerprint,
        steps,
        summary: `Required validation blocked progress; the question agent answered and verified ${recoveryResult.answeredCount} field(s). Retrying the application step.`
      });
    }

    if (recoveryResult.incomplete) {
      return buildStepResult({
        clicked: Boolean(primaryActionResult.clicked || recoveryResult.answeredCount),
        done: false,
        pausedForReview: true,
        errorType: "required_field_audit_failed",
        steps,
        summary: `Required validation blocked progress. ${formatRequiredFieldAuditSummary(recoveryResult.audit)}`
      });
    }
  }

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

  if (primaryActionResult.pausedForReview) {
    return buildStepResult({
      clicked: Boolean(primaryActionResult.clicked),
      done: false,
      pausedForReview: true,
      errorType: primaryActionResult.errorType || "blocked_by_validation",
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
  if (message?.type === "APPLE_CAREERS_COLLECT_SUBMITTED_HISTORY") {
    collectAppleSubmittedHistory()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not read Apple submitted roles." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES") {
    withdrawAppleSubmittedRoles(message.roles || [])
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not withdraw selected Apple roles." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_EXTRACT_JOB") {
    sendResponse({
      ok: true,
      data: extractJobDetails({
        userYearsOfExperience: message.userYearsOfExperience,
        noMatchKeywords: message.noMatchKeywords,
        resumeProfileText: message.resumeProfileText
      })
    });

    return true;
  }

  if (message?.type === "APPLE_CAREERS_EXTRACT_SUBMITTED_ROLE_DETAILS") {
    sendResponse({ ok: true, data: extractAppleSubmittedRoleDetails() });
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
    runApplicationWorkflowStep({
      submissionAttemptCount: message.submissionAttemptCount,
      validationRecoveryAttempts: message.validationRecoveryAttempts,
      previousValidationRecoveryFingerprint: message.previousValidationRecoveryFingerprint
    })
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
