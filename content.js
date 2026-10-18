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
    isApplicationUrl: (url) => url?.origin === "https://jobs.apple.com" && /^\/app\/[^/]+\/apply\/[^/]+\/?$/i.test(url.pathname),
    applyPattern: /^submit resume$/i,
    continuePattern: /^continue$/i,
    finalSubmitPattern: /^submit$/i,
    primaryActionId: "apply-step-continue-button",
    titleSuffixPattern: /\s+-\s+(?:Jobs\s+-\s+)?Careers at Apple\.?$/i

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
      /\/app\/[^/]+\/apply\/([^/?#]+)/i,
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
    .filter(
      (rule) =>
        rule.matchedTerms.length > 0 &&
        rule.candidateEvidence.length === 0 &&
        !isObjectiveCOnlyAlternativeMismatch(text, resumeProfileText, rule)
    );
}

function isObjectiveCOnlyAlternativeMismatch(text, resumeProfileText, rule) {
  if (
    rule.label !== "iOS app development" ||
    !rule.matchedTerms.length ||
    !rule.matchedTerms.every((term) => /^objective[ -]?c$/i.test(term))
  ) {
    return false;
  }

  const alternatives = /\b(?:android|java|objective[ -]?c|python|golang)(?:\s*[\/,]\s*(?:android|java|objective[ -]?c|python|golang)){2,}\b/gi;
  for (const match of String(text || "").matchAll(alternatives)) {
    const list = match[0];
    if (
      /\bobjective[ -]?c\b/i.test(list) &&
      ["java", "python"].some((skill) => textIncludesTerm(resumeProfileText, skill) && textIncludesTerm(list, skill))
    ) {
      return true;
    }
  }
  return false;
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

function isSubmissionConfirmationText(text) {
  const label = normalizeText(text || "");
  return /^(?:submitted|application submitted|resume submitted)(?:\s*:|$)/i.test(label) ||
    /\b(?:your information has been submitted for|(?:your )?(?:application|resume) (?:has been |was |successfully )?submitted|successfully submitted your (?:application|resume)|we (?:have|'ve) received your (?:resume|application))\b/i.test(label);
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

    const label = normalizeText(candidate.innerText || candidate.getAttribute("aria-label") || "");

    if (!label || label.length > 2000 || (label.length > 120 && !/\byour information has been submitted for\b/i.test(label))) {
      continue;
    }

    // The profile's "Your Roles (0 favorited or submitted)" navigation label is
    // not evidence that the current application succeeded.
    if (isSubmissionConfirmationText(label)) {
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

function getAlreadyAppliedSignal() {
  return (
    getAlreadyAppliedDialog() ||
    getAlreadyAppliedToast() ||
    getAlreadyAppliedNotice()
  );
}

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

function getVisibleValidationErrors(options = {}) {
  const alertMessages = getVisibleValidationMessageElements()
    // A network/server alert cannot establish that a final Submit was rejected.
    // Only field-validation feedback permits recovery followed by another Submit.
    .filter(element => !options.submission || isKnownFormValidationFeedback(element) ||
      /\b(?:required|invalid)\b.{0,35}\b(?:field|answer|value|selection)\b|\b(?:field|answer|value|selection)\b.{0,35}\b(?:required|invalid)\b|\bplease (?:complete|fill|answer|select)\b/i.test(element.innerText || element.textContent || ""))
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
    options.assertIdentity?.();
    const submittedSignal = options.expectedJobId && !CareerPeelerApplicationSafety.matchesJob(options.expectedJobId, window.location.href)
      ? getJobBoundSubmissionSignal(options.expectedJobId) : getSubmittedSignal();
    if (submittedSignal) {
      return { type: "submitted", signal: submittedSignal };
    }

    const alreadyAppliedSignal = getAlreadyAppliedSignal();
    if (alreadyAppliedSignal) {
      return { type: "already_applied", signal: alreadyAppliedSignal };
    }

    const validationErrors = getVisibleValidationErrors({ submission: true });
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

function findApplePostingSection(label, selectors) {
  const identified = document.querySelector(selectors);
  if (identified) return identified;
  const heading = Array.from(document.querySelectorAll("h2, h3")).find(element =>
    normalizeText(element.textContent).toLowerCase() === label.toLowerCase());
  let node = heading?.parentElement;
  for (let depth = 0; node && depth < 5; depth += 1, node = node.parentElement) {
    if (node.querySelectorAll("h2, h3").length > 1) break;
    if (normalizeText(node.innerText || "").length > label.length + 25) return node;
  }
  return null;
}

function extractAppleSubmittedRoleDetails() {
  const descriptionElement = findApplePostingSection("Description", "#jobdetails-jobdescription");
  const minimumElement = findApplePostingSection("Minimum Qualifications", "#jobdetails-minimumqualifications");
  const preferredElement = findApplePostingSection("Preferred Qualifications", "#jobdetails-preferredqualifications");
  const responsibilitiesElement = findApplePostingSection("Responsibilities", "#jobdetails-responsibilities, #jobdetails-jobresponsibilities");
  const description = [normalizeText(descriptionElement?.innerText || ""), normalizeText(responsibilitiesElement?.innerText || "")].filter(Boolean).join("\n\n");
  const minimumQualifications = normalizeText(minimumElement?.innerText || "");
  const preferredQualifications = normalizeText(preferredElement?.innerText || "");
  const title = getJobTitle();
  const jobId = getJobId();
  const jobText = [description, minimumQualifications, preferredQualifications].filter(Boolean).join("\n\n");
  const ready = Boolean(
    jobId &&
    title &&
    description.length > 80 &&
    (!minimumElement || minimumQualifications.length > 25) &&
    (!preferredElement || preferredQualifications.length > 25)
  );

  return {
    jobId,
    title,
    url: window.location.href,
    description,
    minimumQualifications,
    minimumQualificationItems: Array.from(minimumElement?.querySelectorAll("li") || [])
      .map((item) => normalizeText(item.innerText || item.textContent || "")).filter(Boolean),
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
        APPLE_ROLE_IDS_PROTECTED_FROM_BATCH_WITHDRAWAL.has(jobId.split("-")[0]) || !favoriteCheckbox || favoriteCheckbox.checked,
      active: Boolean(withdrawButton)
    });
  }

  return Array.from(roles.values());
}

function getAppleHistoryPageIndex() {
  const input = document.querySelector('#profile-roles-pagination input[type="number"]');
  if (!input) {
    return Number(document.querySelector("[data-autom='paginationTotalPages']")?.textContent) === 1 ? 1 : null;
  }
  const value = Number(input?.value);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function assertAppleActiveSubmittedRolesPage() {
  if (getCurrentUrl().origin !== "https://jobs.apple.com" || !/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
    throw new Error("Apple's active submissions page is unavailable. Sign in again, then open Profile → Your Roles → Submissions → Active.");
  }
  if (!/your active submitted roles/i.test(document.body?.innerText || "")) {
    throw new Error('Choose Submissions, then the "Active" filter before analyzing roles.');
  }
}

function collectCurrentAppleSubmittedHistoryPage() {
  assertAppleActiveSubmittedRolesPage();
  const session = getSessionRequiredSignal();
  const busy = Array.from(document.querySelectorAll("[aria-busy='true'], [role='progressbar']")).some(isElementVisible);
  const error = Array.from(document.querySelectorAll("[role='alert']")).filter(isElementVisible)
    .some(element => /\b(?:error|failed|failure|unavailable|unable|timed out|something went wrong|try again)\b/i.test(element.innerText || element.textContent || ""));
  if (session || busy || error) {
    throw new Error(session || "Apple's submissions inventory is still loading or failed to load. Capacity is unknown; try syncing again.");
  }
  const roles = collectSubmittedRoleCards();
  const nextButton = document.querySelector('#profile-roles-pagination button[aria-label="Next Page"]');
  const previousButton = document.querySelector('#profile-roles-pagination button[aria-label="Previous Page"]');
  const enabled = button => Boolean(button && !button.disabled && button.getAttribute("aria-disabled") !== "true");
  const totalText = document.querySelector("[data-autom='paginationTotalPages']")?.textContent?.trim();
  let pageCount = totalText && /^\d+$/.test(totalText) ? Number(totalText) : null;
  let pageIndex = getAppleHistoryPageIndex();
  const empty = roles.length === 0;
  if (empty) {
    // Absent cards/pagination alone can be a signed-out or unfinished SPA.
    // Use the existing total-pages metadata, not guessed empty-state copy.
    // Zero metadata is normalized to one virtual page for existing consumers.
    const rawIndex = document.querySelector('#profile-roles-pagination input[type="number"]')?.value;
    if (pageCount !== 0 || getLoadingSignal() || enabled(nextButton) || enabled(previousButton) ||
      (rawIndex !== undefined && !/^[01]$/.test(String(rawIndex))) || (pageIndex !== null && pageIndex !== 1)) {
      throw new Error("Apple has not confirmed an authenticated empty submissions list. Capacity is unknown; sign in and sync again.");
    }
    pageIndex = 1;
    pageCount = 1;
  } else if (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100 || pageIndex === null ||
    pageIndex > pageCount || enabled(nextButton) !== (pageIndex < pageCount) ||
    roles.some(role => role.active !== true || !/^\d+(?:-\d+)?$/.test(String(role.jobId || "")))) {
    throw new Error("Apple's submissions cards or pagination are incomplete. Wait for Your Roles to finish loading and sync again.");
  }
  return {
    roles,
    pageIndex,
    pageCount,
    accountVerified: true,
    inventoryState: empty ? "confirmed_empty" : "confirmed",
    hasNextPage: enabled(nextButton),
    withdrawalConfirmationOpen: Boolean(findAppleWithdrawalConfirmationModal())
  };
}

async function waitForAppleSubmittedHistoryPage(pageIndex, previousFirstJobId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastSignature = "";
  let stableReads = 0;
  while (Date.now() < deadline) {
    let page;
    try { page = collectCurrentAppleSubmittedHistoryPage(); } catch (_) { stableReads = 0; }
    if (page && (pageIndex === null || page.pageIndex === pageIndex)) {
      const roles = page.roles;
      const signature = `${page.pageIndex}|${page.pageCount}|${page.hasNextPage}|${page.inventoryState}|${page.withdrawalConfirmationOpen}|${roles.map((role) => role.jobId).join("|")}`;
      stableReads = signature === lastSignature ? stableReads + 1 : 1;
      lastSignature = signature;
      if ((page.inventoryState === "confirmed_empty" || roles[0]?.jobId !== previousFirstJobId) && stableReads >= 3) {
        return page;
      }
    } else { stableReads = 0; lastSignature = ""; }
    await delay(300);
  }
  throw new Error("Apple's submissions page did not finish loading. Sign in again if your session expired.");
}

async function goToAppleSubmittedHistoryPage(targetPageIndex, { deadline = Infinity } = {}) {
  let page = collectCurrentAppleSubmittedHistoryPage();
  const target = Number(targetPageIndex);
  if (!Number.isInteger(target) || target < 1 || target > page.pageCount) {
    throw new Error("The requested Apple submissions page is unavailable.");
  }
  while (page.pageIndex !== target) {
    const forward = page.pageIndex < target;
    const button = document.querySelector(`#profile-roles-pagination button[aria-label="${forward ? "Next Page" : "Previous Page"}"]`);
    if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") {
      throw new Error("Apple's submissions pagination could not reach the requested page.");
    }
    const previousFirstJobId = page.roles[0]?.jobId;
    button.click();
    page = await waitForAppleSubmittedHistoryPage(page.pageIndex + (forward ? 1 : -1), previousFirstJobId,
      Math.min(15000, Math.max(0, deadline - Date.now())));
  }
  return page;
}

async function advanceAppleSubmittedHistoryPage({ deadline = Infinity } = {}) {
  const page = collectCurrentAppleSubmittedHistoryPage();
  if (!page.hasNextPage) return { advanced: false, page };
  const button = document.querySelector('#profile-roles-pagination button[aria-label="Next Page"]');
  button.click();
  return { advanced: true, page: await waitForAppleSubmittedHistoryPage(page.pageIndex + 1, page.roles[0]?.jobId,
    Math.min(15000, Math.max(0, deadline - Date.now()))) };
}

async function collectAllAppleSubmittedHistoryPages({ restoreFirstPage = true, restoreOriginalPage = false, deadline = Infinity } = {}) {
  const readStartedAt = Date.now();
  let startingPage;
  try { startingPage = collectCurrentAppleSubmittedHistoryPage(); }
  catch (error) {
    if (getSessionRequiredSignal()) throw error;
    // Proceed can close before Apple's replacement list has finished rendering.
    // Wait for a valid stable page without interpreting the gap as an empty list.
    startingPage = await waitForAppleSubmittedHistoryPage(null, undefined,
      Math.min(15000, Math.max(0, deadline - Date.now())));
  }
  if (startingPage.withdrawalConfirmationOpen) {
    throw new Error("Resolve Apple's withdrawal confirmation before refreshing submissions.");
  }
  try {
    await goToAppleSubmittedHistoryPage(1, { deadline });
    // Already being on page one does not mean its SPA inventory has settled.
    let page = await waitForAppleSubmittedHistoryPage(1, undefined,
      Math.min(15000, Math.max(0, deadline - Date.now())));
    const expectedPageCount = page.pageCount;
    const pages = [];
    while (pages.length < 100) {
      if (page.pageCount !== expectedPageCount || page.pageIndex !== pages.length + 1) {
        throw new Error("Apple's submissions pagination changed during synchronization. Capacity is unknown; sync again.");
      }
      pages.push(page);
      if (!page.hasNextPage) {
        if (page.pageIndex !== page.pageCount || pages.length !== page.pageCount) {
          throw new Error("Apple's submissions pagination changed before every page could be refreshed.");
        }
        if (restoreFirstPage && !restoreOriginalPage) await goToAppleSubmittedHistoryPage(1, { deadline });
        const inventory = { pages, pageCount: page.pageCount, readStartedAt, readCompletedAt: Date.now() };
        return { ...inventory, ...CareerPeelerApplicationSafety.validateSubmittedHistoryInventory(inventory) };
      }
      const next = await advanceAppleSubmittedHistoryPage({ deadline });
      if (!next.advanced) break;
      page = next.page;
    }
    throw new Error("Apple's active submissions could not be refreshed across every page.");
  } finally {
    if (restoreOriginalPage) await goToAppleSubmittedHistoryPage(startingPage.pageIndex, { deadline });
  }
}

async function openAppleActiveSubmissionsForInventory() {
  if (getSiteId() !== "apple" || !/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
    throw new Error("Open Apple's Your Roles page to verify active submissions.");
  }
  try { assertAppleActiveSubmittedRolesPage(); return; } catch (_) {}
  const deadline = Date.now() + 10000;
  // These menu attributes come from the supplied Apple DOM. Navigation occurs
  // only in the fresh background tab belonging to an explicit workflow.
  const submissions = document.querySelector('button[data-autom="Submissions"]');
  if (!submissions || !isElementVisible(submissions) || submissions.disabled) throw new Error("Apple's Submissions menu could not be verified.");
  submissions.click();
  while (Date.now() < deadline) {
    const active = document.querySelector('button[data-autom="Active"]');
    if (active && isElementVisible(active) && !active.disabled && active.getAttribute("aria-disabled") !== "true") {
      active.click();
      return;
    }
    await delay(150);
  }
  throw new Error("Apple's Active submissions view could not be opened. The withdrawal remains unknown.");
}

async function collectStableAppleSubmittedHistoryInventory({ timeoutMs = 45000, notBefore = Date.now() } = {}) {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let previous = null;
  let lastError = null;
  // At most three complete passes: a changing inventory may settle for passes
  // two and three, but never becomes successful merely because retries ran out.
  for (let attempt = 0; attempt < 3 && Date.now() < deadline; attempt++) {
    try {
      const current = await collectAllAppleSubmittedHistoryPages({ restoreFirstPage: false,
        restoreOriginalPage: false, deadline });
      if (previous) {
        try {
          return CareerPeelerApplicationSafety.validateWithdrawalInventoryEvidence({ ...current, passes: [previous, current] },
            { notBefore, now: Date.now() });
        } catch (error) { lastError = error; }
      }
      previous = current;
    } catch (error) {
      previous = null;
      lastError = error;
    }
  }
  throw new Error(lastError?.message || "Apple's active submissions did not produce two complete, stable inventory reads. The withdrawal outcome is unknown.");
}

function findSubmittedRoleCard(jobId) {
  const anchors = Array.from(document.querySelectorAll('a[href*="/en-us/details/"]')).filter((candidate) =>
    isElementVisible(candidate) && getJobIdFromUrl(candidate.href) === String(jobId)
  );
  if (anchors.length !== 1) return null;
  const anchor = anchors[0];

  let card = anchor;
  while (card && card !== document.body) {
    const controls = card.querySelectorAll(`[id="js-withdraw-link-${jobId}"]`);
    const withdrawButton = controls.length === 1 ? controls[0] : null;
    if (withdrawButton && isElementVisible(withdrawButton) && card.querySelectorAll('a[href*="/en-us/details/"]').length === 1) {
      const favoriteCheckbox = card.querySelector(`input[type="checkbox"][id="addToFavoriteId-favorite-${jobId}"]`);
      if (anchor.id !== `role-title-${jobId}`) return null;
      return {
        card,
        withdrawButton,
        anchor,
        favoriteCheckbox,
        title: cleanTitle(anchor.innerText || ""),
        jobId: getJobIdFromUrl(anchor.href),
        favorite: favoriteCheckbox ? Boolean(favoriteCheckbox.checked) : null
      };
    }
    card = card.parentElement;
  }
  return null;
}

async function checkAppleSubmittedRoleStatus(jobId, title, expectedPageIndex, beforeCount, hadNextPage) {
  if (getSiteId() !== "apple" || !/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
    throw new Error("Apple's submissions page is unavailable. Sign in again before continuing the batch.");
  }
  if (findAppleWithdrawalConfirmationModal()) {
    return { confirmationOpen: true, active: null };
  }
  const result = await waitForSubmittedRoleWithdrawal(jobId, title, expectedPageIndex, beforeCount, hadNextPage);
  if (result.withdrawn) {
    return { confirmationOpen: false, active: false };
  }
  const match = findSubmittedRoleCard(jobId);
  return { confirmationOpen: false, active: match ? true : null, favorite: match?.favorite ?? null };
}

function getAppleWithdrawalFailureMessage() {
  const candidates = document.querySelectorAll('#global-alert, [role="alert"], [aria-live="assertive"], .rc-overlay-popup-outer');
  for (const candidate of candidates) {
    if (!isElementVisible(candidate)) continue;
    const message = normalizeText(candidate.innerText || candidate.textContent || "");
    if (/\b(unable|cannot|can't|could not|failed|not able|error)\b.{0,100}\bwithdraw\b|\bwithdraw\b.{0,100}\b(failed|unsuccessful|error|unavailable)\b/i.test(message)) {
      return message.slice(0, 350);
    }
  }
  return null;
}

function getAppleWithdrawalSuccessMessage(title) {
  const message = normalizeText(document.querySelector("#global-alert")?.innerText || "");
  return /submission has been successfully withdrawn/i.test(message) &&
    (!title || message.toLowerCase().includes(normalizeText(title).toLowerCase()))
    ? message : null;
}

async function waitForSubmittedRoleWithdrawal(jobId, title, expectedPageIndex, beforeCount, hadNextPage, timeoutMs = 15000, successIsFresh = () => true) {
  // The other parameters remain for existing callers; title alerts, expected
  // page number and page-card counts are deliberately not outcome evidence.
  const notBefore = Date.now();
  try {
    if (!/^\d+(?:-\d+)?$/.test(String(jobId || ""))) throw new Error("The exact selected Apple job ID is unavailable.");
    const inventory = await collectStableAppleSubmittedHistoryInventory({ timeoutMs, notBefore });
    const active = inventory.roles.some(role => role.jobId === String(jobId));
    return active ? { withdrawn: false, outcome: "active", inventory,
      error: "Apple's complete active-submission inventory still contains the selected job. The withdrawal was not confirmed." }
      : { withdrawn: true, outcome: "inactive", inventory };
  } catch (error) {
    return { withdrawn: false, outcome: "unknown", error: error?.message || "The withdrawal outcome could not be verified." };
  }
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

async function waitForAppleWithdrawalConfirmationModal(previousError = null, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const confirmation = findAppleWithdrawalConfirmationModal();
    if (confirmation?.proceedButton && !confirmation.proceedButton.disabled &&
      confirmation.proceedButton.getAttribute("aria-disabled") !== "true") return { confirmation };
    const error = getAppleWithdrawalFailureMessage();
    if (error && error !== previousError) return { error };
    await delay(150);
  }
  return { error: getAppleWithdrawalFailureMessage() ||
    (findAppleWithdrawalConfirmationModal() ? "Apple's Proceed button did not become enabled and visible." : null) };
}

async function clickAppleWithdrawalControl(operation, stage) {
  const { jobId, batchId, requestId, pageIndex } = operation;
  let response;
  try {
    response = await chrome.runtime.sendMessage({
      type: "APPLE_CAREERS_TRUSTED_APPLE_WITHDRAW_CLICK",
      jobId, batchId, requestId, stage, expectedPageIndex: pageIndex
    });
  } catch (error) {
    // A transport failure cannot prove that Chrome did not deliver final input.
    if (stage === "proceed") error.outcomeUnknown = true;
    throw error;
  }
  if (!response?.ok || response.data?.jobId !== jobId || response.data?.batchId !== batchId ||
      response.data?.requestId !== requestId || response.data?.identityVerified !== true || response.data?.actionActivated !== true) {
    const error = new Error(response?.error || "Chrome could not acknowledge the bound Apple withdrawal control.");
    error.outcomeUnknown = stage === "proceed" && (!response || response.data?.outcomeUnknown === true || response.ok === true);
    throw error;
  }
}

async function waitForAppleWithdrawalConfirmationToClose(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!findAppleWithdrawalConfirmationModal()) return true;
    await delay(150);
  }
  return false;
}

// Page-local action proofs are deliberately not restored after navigation or
// worker restart. An interrupted batch requires a fresh explicit review.
const appleWithdrawalOperations = new Map();
function findAppleWithdrawalOperation(message) {
  const operation = appleWithdrawalOperations.get(`${message.batchId}:${message.requestId}`);
  if (!operation || operation.jobId !== message.jobId || operation.batchId !== message.batchId ||
      operation.requestId !== message.requestId) throw new Error("The exact withdrawal request could not be verified.");
  return operation;
}

async function submitAppleWithdrawalInventory(operation, inventory) {
  const response = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_REPORT_WITHDRAWAL_INVENTORY",
    jobId: operation.jobId, batchId: operation.batchId, requestId: operation.requestId, inventory });
  const data = response?.data;
  if (!response?.ok || data?.jobId !== operation.jobId || data.batchId !== operation.batchId ||
      data.requestId !== operation.requestId || data.inventoryVerified !== true || data.proofVersion !== 2 ||
      !["active", "inactive"].includes(data.outcome)) {
    throw new Error(response?.error || "Apple's exact withdrawal inventory could not be durably verified.");
  }
  if (data.outcome === "inactive") {
    const current = collectCurrentAppleSubmittedHistoryPage();
    if (current.roles.some(role => role.jobId === operation.jobId && role.active === true)) {
      await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_INVALIDATE_WITHDRAWAL_OUTCOME",
        jobId: operation.jobId, batchId: operation.batchId, requestId: operation.requestId,
        reason: "The exact selected job reappeared active before its withdrawal result was accepted." });
      throw new Error("Apple's current page contradicts the withdrawal proof. Sync Submissions again.");
    }
  }
  return data;
}

async function getAppleWithdrawalStatus(message) {
  const operation = findAppleWithdrawalOperation(message);
  await operation.promise;
  if (findAppleWithdrawalConfirmationModal()) return { jobId: operation.jobId, batchId: operation.batchId,
    requestId: operation.requestId, outcome: "unknown", confirmationOpen: true, active: null,
    withdrawalConfirmed: false, identityVerified: false };
  try {
    const inventory = await collectStableAppleSubmittedHistoryInventory();
    const verified = await submitAppleWithdrawalInventory(operation, inventory);
    return { ...verified, confirmationOpen: false };
  } catch (error) {
    return { jobId: operation.jobId, batchId: operation.batchId, requestId: operation.requestId,
      outcome: "unknown", confirmationOpen: Boolean(findAppleWithdrawalConfirmationModal()), active: null,
      withdrawalConfirmed: false, identityVerified: false, error: error?.message };
  }
}

function withdrawAppleSubmittedRoles(requestedRoles = [], expectedPageIndex, { batchId, requestId } = {}) {
  if (getSiteId() !== "apple" || !/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
    throw new Error("Open your Apple Careers roles page before withdrawing applications.");
  }
  if (!Array.isArray(requestedRoles) || requestedRoles.length !== 1 || !batchId || !requestId) {
    throw new Error("Send exactly one reviewed role with its confirmed batch and unique request ID.");
  }
  const role = requestedRoles[0];
  const key = `${batchId}:${requestId}`;
  const previous = appleWithdrawalOperations.get(key);
  if (previous) {
    if (previous.jobId !== role.jobId || previous.pageIndex !== expectedPageIndex) {
      throw new Error("This withdrawal request was already bound to a different job or page.");
    }
    return previous.promise; // Duplicate delivery cannot replay any click.
  }
  if (getAppleHistoryPageIndex() !== expectedPageIndex) throw new Error("Apple changed the visible submissions page.");
  const match = findSubmittedRoleCard(role.jobId);
  if (!match || match.favorite !== false ||
      APPLE_ROLE_IDS_PROTECTED_FROM_BATCH_WITHDRAWAL.has(String(role.jobId).split("-")[0])) {
    throw new Error("The selected role is missing, starred, protected, or its identity could not be verified.");
  }
  if (Array.from(appleWithdrawalOperations.values()).some(operation => !operation.finished)) {
    throw new Error("Another withdrawal is still pending on this Apple page.");
  }
  const pageBefore = collectCurrentAppleSubmittedHistoryPage();
  const operation = { jobId: role.jobId, batchId, requestId, pageIndex: expectedPageIndex, finished: false };
  operation.guard = CareerPeelerAppleWithdrawalSafety.create({
    jobId: role.jobId, batchId, requestId, pageIndex: expectedPageIndex,
    readRole: findSubmittedRoleCard, readPage: collectCurrentAppleSubmittedHistoryPage,
    findConfirmation: findAppleWithdrawalConfirmationModal, getFailure: getAppleWithdrawalFailureMessage
  });
  appleWithdrawalOperations.set(key, operation);
  operation.promise = Promise.resolve().then(async () => {
    const identity = { jobId: role.jobId, batchId, requestId };
    try {
      await clickAppleWithdrawalControl(operation, "open");
      await operation.guard.waitConfirmation();
      await clickAppleWithdrawalControl(operation, "proceed");
      if (!operation.guard.proceeded) throw new Error("The bound Proceed action was not observed.");
      if (!(await waitForAppleWithdrawalConfirmationToClose())) throw new Error("Apple's original confirmation did not close after Proceed.");
      const result = await waitForSubmittedRoleWithdrawal(role.jobId, match.title, expectedPageIndex,
        pageBefore.roles.filter(item => item.active).length, pageBefore.hasNextPage, 15000,
        () => operation.guard.successUpdated);
      if (!result.inventory) throw new Error(result.error || "Apple did not confirm a complete withdrawal inventory.");
      const verified = await submitAppleWithdrawalInventory(operation, result.inventory);
      if (verified.outcome === "active") return { ...identity, ...verified, outcomeUnknown: false,
        withdrawn: [], failed: [{ jobId: role.jobId, title: role.title,
          error: "Apple confirmed this job is still active. Review a new withdrawal selection before another attempt." }] };
      return { ...identity, ...verified, outcomeUnknown: false,
        withdrawn: [{ jobId: role.jobId, title: role.title }], failed: [] };
    } catch (error) {
      return { ...identity, identityVerified: false, outcome: "unknown", outcomeUnknown: operation.guard.proceeded || error?.outcomeUnknown === true,
        withdrawn: [], failed: [{ jobId: role.jobId, title: role.title,
          error: `${error?.message || "The withdrawal could not be verified."} ${operation.guard.proceeded || error?.outcomeUnknown === true ? "The outcome is unknown; reconcile in Apple Careers before retrying." : "No bound final confirmation was accepted."}` }] };
    } finally {
      operation.finished = true;
      operation.guard.dispose();
      // Bound memory use without dropping active requests or replaying actions.
      if (appleWithdrawalOperations.size > 100) for (const [oldKey, old] of appleWithdrawalOperations) {
        if (old.finished && oldKey !== key) { appleWithdrawalOperations.delete(oldKey); break; }
      }
    }
  });
  return operation.promise;
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
  const applePage = document.querySelector("#search-pagnation #pagination-search-page-number");
  if (applePage && /^\d+$/.test(String(applePage.value).trim()) && Number(applePage.value) > 0) {
    return Number(applePage.value);
  }
  const url = new URL(window.location.href);
  const pageParams = ["page", "pg", "p"];

  for (const param of pageParams) {
    const value = Number(url.searchParams.get(param));
    if (Number.isInteger(value) && value > 0) {
      return value;
    }
  }

  const offsetValue = url.searchParams.get("offset") ?? url.searchParams.get("start");
  const offset = offsetValue === null ? NaN : Number(offsetValue);
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
        element: candidate,
        action: "navigate",
        url: candidate.href
      };
    }

    return {
      element: candidate,
      action: "click"
    };
  }

  return null;
}

function getJobLinkSetKey(links) {
  return links
    .map((link) => link.url)
    .sort()
    .join("|");
}

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

function appleSearchIdentity(value) {
  let url;
  try { url = new URL(value); } catch (_) {
    throw appleSearchPaginationError("The filtered Apple search could not be verified.", "search_filter_changed", false);
  }
  if (url.origin !== "https://jobs.apple.com" || !/^\/[a-z]{2}-[a-z]{2}\/search\/?$/i.test(url.pathname)) {
    throw appleSearchPaginationError("The filtered Apple search could not be verified.", "search_filter_changed", false);
  }
  url.searchParams.delete("page");
  url.searchParams.sort();
  url.pathname = url.pathname.toLowerCase().replace(/\/$/, "");
  url.hash = "";
  return url.href;
}

function appleSearchPaginationError(message, errorType = "search_pagination_unavailable", retryable = true) {
  return Object.assign(new Error(message), { errorType, retryable });
}

function appleSearchPageSignature(links) {
  return links.map(link => String(link.jobId)).sort().join("|");
}

function readAppleSearchPagination(expectedSearchUrl) {
  const session = getSessionRequiredSignal();
  if (session) throw appleSearchPaginationError(session, "session_or_login_required", false);
  if (appleSearchIdentity(window.location.href) !== appleSearchIdentity(expectedSearchUrl)) {
    throw appleSearchPaginationError("Apple's search filters changed. Saved rankings remain available.", "search_filter_changed", false);
  }
  if (Array.from(document.querySelectorAll("[aria-busy='true'], [role='progressbar']")).some(isElementVisible)) {
    throw appleSearchPaginationError("Apple's search results are still loading.", "search_results_loading");
  }
  const error = Array.from(document.querySelectorAll("[role='alert']")).find(element => isElementVisible(element) &&
    /\b(error|failed|failure|unavailable|unable|timed out|something went wrong|try again)\b/i.test(element.innerText || element.textContent || ""));
  if (error) throw appleSearchPaginationError(normalizeText(error.innerText || error.textContent), "search_results_failed");
  const pagination = document.querySelector("#search-pagnation");
  const input = pagination?.querySelector("#pagination-search-page-number");
  const total = pagination?.querySelector("[data-autom='paginationTotalPages']");
  const next = pagination?.querySelector('button[aria-label="Next Page"]');
  const previous = pagination?.querySelector('button[aria-label="Previous Page"]');
  const ordinal = String(input?.value ?? "").trim();
  const totalText = String(total?.textContent ?? "").trim();
  const currentPage = /^\d+$/.test(ordinal) ? Number(ordinal) : null;
  const pageCount = /^\d+$/.test(totalText) ? Number(totalText) : null;
  const visible = element => Boolean(element && element.isConnected !== false && isElementVisible(element));
  if (!pagination || !isElementVisible(pagination) || !Number.isInteger(currentPage) || !Number.isInteger(pageCount) || currentPage < 1 || currentPage > pageCount ||
    !visible(next) || !visible(previous) || !isActionDisabled(next) !== (currentPage < pageCount) || !isActionDisabled(previous) !== (currentPage > 1)) {
    throw appleSearchPaginationError("Apple's search pagination is incomplete or still loading.");
  }
  return { currentPage, pageCount, hasNextPage: currentPage < pageCount, next };
}

async function waitForVerifiedAppleSearchPage({ expectedSearchUrl, expectedPage, previousPageSignature = null,
  timeoutMs = 30000, intervalMs = 300, stableChecksRequired = 4 } = {}) {
  if (!Number.isInteger(expectedPage) || expectedPage < 1 || !expectedSearchUrl) {
    throw appleSearchPaginationError("The intended Apple search page is missing.", "search_page_identity_missing", false);
  }
  const deadline = Date.now() + timeoutMs;
  let lastSignature = null;
  let stableReads = 0;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const page = readAppleSearchPagination(expectedSearchUrl);
      if (page.currentPage > expectedPage) {
        throw appleSearchPaginationError(`Apple opened search page ${page.currentPage} instead of ${expectedPage}.`, "search_page_mismatch", false);
      }
      const links = collectJobLinks();
      const signature = appleSearchPageSignature(links);
      if (page.currentPage === expectedPage && links.length &&
        links.every(link => /^\d+(?:-\d+)?$/.test(String(link.jobId))) && signature !== previousPageSignature) {
        const identity = `${page.currentPage}|${page.pageCount}|${signature}`;
        stableReads = identity === lastSignature ? stableReads + 1 : 1;
        lastSignature = identity;
        if (stableReads >= stableChecksRequired) {
          return { ...page, next: undefined, links, paginationVerified: true, url: window.location.href };
        }
      } else {
        stableReads = 0;
        lastSignature = null;
        lastError = appleSearchPaginationError(`Apple's search page ${expectedPage} has not finished loading.`, "search_page_not_ready");
      }
    } catch (error) {
      if (error.retryable === false) throw error;
      stableReads = 0;
      lastSignature = null;
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw appleSearchPaginationError(lastError?.message || `Apple's search page ${expectedPage} did not finish loading.`,
    lastError?.errorType || "search_page_timeout", true);
}

async function goToVerifiedAppleNextPage(options) {
  const { expectedSearchUrl, expectedFromPage, expectedPage, previousPageSignature } = options;
  if (!Number.isInteger(expectedFromPage) || expectedFromPage < 1 || expectedPage !== expectedFromPage + 1 ||
    typeof previousPageSignature !== "string" || !previousPageSignature) {
    throw appleSearchPaginationError("The intended next Apple search page is missing.", "search_page_identity_missing", false);
  }
  const deadline = Date.now() + (options.timeoutMs ?? 30000);
  let lastError;
  while (Date.now() < deadline) {
    let page;
    try { page = readAppleSearchPagination(expectedSearchUrl); } catch (error) {
      if (error.retryable === false) throw error;
      lastError = error;
      await delay(300);
      continue;
    }
    if (page.currentPage === expectedPage) {
      const verified = await waitForVerifiedAppleSearchPage({ ...options, timeoutMs: Math.max(1, deadline - Date.now()) });
      return { ok: true, action: "click", currentPage: verified.currentPage, pageCount: verified.pageCount,
        paginationVerified: true, alreadyAdvanced: true };
    }
    if (page.currentPage !== expectedFromPage || !page.hasNextPage) {
      throw appleSearchPaginationError(`Apple's current search page does not match page ${expectedFromPage}.`, "search_page_mismatch", false);
    }
    if (appleSearchPageSignature(collectJobLinks()) !== previousPageSignature) {
      throw appleSearchPaginationError("Apple's search results changed before pagination. Saved rankings remain available.", "search_page_changed", false);
    }
    const control = page.next;
    if (!isElementVisible(control) || isActionDisabled(control) || control.isConnected === false) {
      lastError = appleSearchPaginationError("Apple's next-page control is still loading.");
      await delay(300);
      continue;
    }
    // A second click after a slow transition can skip an entire unranked page.
    control.click();
    const verified = await waitForVerifiedAppleSearchPage({ ...options, timeoutMs: Math.max(1, deadline - Date.now()) });
    return { ok: true, action: "click", currentPage: verified.currentPage, pageCount: verified.pageCount, paginationVerified: true };
  }
  throw lastError || appleSearchPaginationError("Apple's next-page control did not finish loading.");
}

async function goToNextPage(options = {}) {
  if (options.expectedSearchUrl) return goToVerifiedAppleNextPage(options);
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
  const candidate = nextPageControl.element;
  if (candidate && isElementVisible(candidate) && !isActionDisabled(candidate) && candidate.isConnected !== false) {
    candidate.click();
    const changed = await waitForJobLinksChange(previousLinks);
    return changed
      ? { ok: true, action: "click" }
      : { ok: false, reason: "The job list did not visibly change after clicking the next-page control." };
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

function findJobSpecificApplyAction(siteConfig) {
  return findClickableByText(siteConfig?.applyPattern || /^submit resume$/i);
}

async function waitForJobSpecificApplyAction(siteConfig, jobId, timeoutMs = 6000, options = {}) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    options.assertIdentity?.();
    const element = findJobSpecificApplyAction(siteConfig, jobId);

    if (element) {
      return element;
    }

    await delay(300);
  }

  return null;
}

async function readAppleJobApplicability(expectedJobId) {
  const assertIdentity = () => assertAppleWorkflowIdentity({ expectedJobId });
  assertIdentity();
  const site = getSiteConfig();
  if (getSessionRequiredSignal()) {
    return { jobId: getJobId(), url: window.location.href, identityVerified: true, canApply: false, alreadySubmitted: false,
      errorType: "session_or_login_required" };
  }
  if (!site?.isJobDetailUrl(getCurrentUrl())) {
    return { jobId: getJobId(), url: window.location.href, identityVerified: true, canApply: false, alreadySubmitted: false };
  }
  const alreadySubmitted = () => Boolean(getSubmittedSignal() || getAlreadyAppliedSignal());
  let action = null;
  if (!alreadySubmitted()) action = await waitForJobSpecificApplyAction(site, expectedJobId, 6000, { assertIdentity });
  assertIdentity();
  return { jobId: getJobId(), url: window.location.href, identityVerified: true,
    alreadySubmitted: alreadySubmitted(), canApply: Boolean(action && !isActionDisabled(action)) };
}

// Recovery needs stronger evidence than a generic Submitted button or an
// already-applied notice (which can also describe a withdrawn application).
// Observe only; never open an application or click a control to obtain proof.
function readAppleSubmittedControlEvidence(expectedJobId) {
  const wrappers = document.querySelectorAll("#jobdetails-wrapper");
  if (wrappers.length !== 1) return null;
  const wrapper = wrappers[0];
  const titles = wrapper.querySelectorAll("#jobdetails-postingtitle");
  const numbers = wrapper.querySelectorAll("#jobdetails-jobnumber[itemprop='identifier']");
  if (titles.length !== 1 || numbers.length !== 1 || !isElementVisible(titles[0]) || !isElementVisible(numbers[0])) return null;
  const nodes = [wrapper];
  const controls = [];
  for (const id of ["jobdetails-jobdetails-jobdetailheader-actions-jobdetailssubmitresume",
    "jobdetails-jobdetails-jobdetailfooter-actions-jobdetailssubmitresume"]) {
    const matches = wrapper.querySelectorAll(`[id="${id}"]`);
    if (matches.length !== 1) return null;
    const control = matches[0];
    nodes.push(control);
    controls.push({ id, tagName: control.tagName, role: control.getAttribute("role"),
      ariaDisabled: control.getAttribute("aria-disabled"), tabIndex: control.getAttribute("tabindex"),
      href: control.getAttribute("href"), ariaLabel: control.getAttribute("aria-label"),
      text: normalizeText(control.innerText || control.textContent || ""),
      disabledClass: control.classList.contains("disabled"), visible: isElementVisible(control), connected: control.isConnected });
  }
  const signOut = document.querySelectorAll("#search-localnav-link-sign-out");
  const signIn = document.querySelectorAll("#search-localnav-link-sign-in");
  const controlEvidence = { url: window.location.href, title: normalizeText(titles[0].innerText || titles[0].textContent || ""),
    roleNumber: normalizeText(numbers[0].innerText || numbers[0].textContent || ""), controls,
    authenticated: signOut.length === 1 && isElementVisible(signOut[0]) &&
      /\/logout\/?(?:[?#]|$)/i.test(signOut[0].getAttribute("href") || "") &&
      !Array.from(signIn).some(isElementVisible) };
  const signal = CareerPeelerApplicationSafety.submittedControlEvidence(expectedJobId, controlEvidence);
  return signal ? { ...signal, controlEvidence, nodes } : null;
}

async function readAppleRecoverySubmissionStatus(expectedJobId, requestId, notBefore) {
  const observe = () => {
    assertAppleWorkflowIdentity({ expectedJobId });
    if (!getSiteConfig()?.isJobDetailUrl(getCurrentUrl())) return null;
    if (!Number.isFinite(notBefore) || !Number.isFinite(globalThis.performance?.timeOrigin) ||
        globalThis.performance.timeOrigin < notBefore) return null;
    if (getSessionRequiredSignal()) return null;
    if (document.readyState === "loading" || getLoadingSignal()) return null;
    const negative = /\b(?:no|not|never|cannot|unable|failed|failure|rejected|withdrawn|withdraw|inactive|unsuccessful|error|pending)\b|n['’]t\b/i;
    if (Array.from(document.querySelectorAll("#global-alert, [role='alert'], [data-autom='submission-confirmation']"))
      .some(element => isElementVisible(element) && negative.test(normalizeText(element.innerText || element.textContent || "")))) return null;
    const controls = readAppleSubmittedControlEvidence(expectedJobId);
    // If Apple's known wrapper is present, conflicting/incomplete controls
    // cannot be bypassed by a stale confirmation elsewhere on the page.
    if (!controls && document.querySelectorAll("#jobdetails-wrapper").length) return null;
    const signal = controls || getJobBoundSubmissionSignal(expectedJobId);
    if (signal && negative.test(signal.text)) return null;
    return signal;
  };
  const first = observe();
  await delay(300);
  const second = observe();
  const confirmed = Boolean(first && second && first.jobId === second.jobId && first.text === second.text &&
    first.source === second.source && (!first.nodes || first.nodes.every((node, index) =>
      node === second.nodes?.[index] && node.isConnected)));
  const signal = confirmed ? { jobId: second.jobId, text: second.text,
    ...(second.source ? { source: second.source, title: second.title } : {}) } : null;
  return { requestId, jobId: getJobId(), url: window.location.href, identityVerified: true,
    submissionOutcome: confirmed ? "confirmed" : "unknown",
    proof: confirmed ? second.source || "job_identified_submission" : null,
    controlEvidence: confirmed ? second.controlEvidence : undefined,
    documentStartedAt: globalThis.performance?.timeOrigin,
    observedAt: Date.now(), signal };
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

    options.assertIdentity?.();
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
    shouldStop: options.shouldStop,
    assertIdentity: options.assertIdentity
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
  await options.assertOwnership?.();
  options.assertIdentity?.();
  if (!pattern.test(getActionLabel(element))) {
    throw Object.assign(new Error("The application action changed before it could be clicked. Review this step."), { code: "workflow_action_changed" });
  }
  await options.assertSavedAnswers?.();
  options.assertIdentity?.();
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

const appleSubmissionAttempts = new Map();

function blockedSubmissionResult(outcome, errorType, summary) {
  return { clicked: false, done: false, pending: false, pausedForReview: true,
    submissionOutcome: outcome, errorType, summary };
}

function checkSubmissionPermission(options = {}) {
  const local = appleSubmissionAttempts.get(options.expectedJobId || getJobId());
  const parentCount = Math.max(0, Number(options.submissionAttemptCount) || 0);
  const count = Math.max(parentCount, local?.count || 0);
  // Older page-local rejection cannot authorize retry of a newer unknown attempt.
  const outcome = parentCount > (local?.count || 0)
    ? options.submissionOutcome || "unknown"
    : local?.outcome || options.submissionOutcome || (count ? "unknown" : "not_attempted");
  if (outcome === "confirmed") return { clicked: false, done: true, pending: false,
    alreadySubmitted: true, submissionOutcome: "confirmed", summary: "This role's submission was already confirmed." };
  if (outcome === "unknown" || (count > 0 && outcome !== "rejected")) return blockedSubmissionResult("unknown", "clicked_but_unconfirmed",
    "A previous Submit outcome is still unknown. Check this role in Your Roles before retrying; Submit was not clicked again.");
  if (count >= MAX_FINAL_SUBMIT_ATTEMPTS) return blockedSubmissionResult("rejected", "submission_retry_limit",
    "The final Submit attempt limit was reached. Review this application manually; Submit was not clicked again.");
  return null;
}

async function clickAndDetectSubmission(element, steps, options = {}) {
  const blocked = checkSubmissionPermission(options);
  if (blocked) return blocked;
  element.scrollIntoView({
    block: "center"
  });
  await delay(200);
  options.assertIdentity?.();
  const lateBlock = checkSubmissionPermission(options);
  if (lateBlock) return lateBlock;
  const existingValidation = getVisibleValidationErrors({ submission: true });
  if (existingValidation.length) return blockedSubmissionResult(options.submissionOutcome || "not_attempted", "blocked_by_validation",
    `Submit was not clicked because validation is already visible: ${existingValidation.join("; ")}`);
  await options.assertSavedAnswers?.();
  await options.assertOwnership?.("submit");
  options.assertIdentity?.();
  await options.assertSavedAnswers?.();
  options.assertIdentity?.();
  const postPermitBlock = checkSubmissionPermission(options);
  if (postPermitBlock) return postPermitBlock;
  const submissionKey = options.expectedJobId || getJobId();
  const count = Math.max(Number(options.submissionAttemptCount) || 0, appleSubmissionAttempts.get(submissionKey)?.count || 0) + 1;
  // Reserve synchronously before the click; a concurrent/lost-reply request on
  // this page must not issue a second Submit while its result is unknown.
  appleSubmissionAttempts.set(submissionKey, { count, outcome: "unknown" });
  element.click();
  steps.push({
    step: "Submit application",
    status: "clicked",
    label: getActionLabel(element)
  });

  const outcome = await waitForSubmissionOutcome({ ...options.outcomeOptions, expectedJobId: options.expectedJobId, assertIdentity: options.assertObservationIdentity || options.assertIdentity });

  if (outcome?.type === "submitted") {
    appleSubmissionAttempts.set(submissionKey, { count, outcome: "confirmed" });
    await reportAppleSubmitObservation(options, "confirmed");
    steps.push({
      step: "Confirm application submitted",
      status: "detected",
      label: outcome.signal.text
    });
    return {
      clicked: true,
      done: true,
      pending: false,
      submissionOutcome: "confirmed",
      summary: "Clicked final Submit and detected Submitted confirmation."
    };
  }

  if (outcome?.type === "already_applied") {
    appleSubmissionAttempts.set(submissionKey, { count, outcome: "confirmed" });
    await reportAppleSubmitObservation(options, "confirmed");
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
      submissionOutcome: "confirmed",
      errorType: "already_applied",
      summary: alreadyAppliedSignal.body || alreadyAppliedSignal.text || "You've already applied for this job. Unable to apply again."
    };
  }

  const postClickValidationErrors = outcome?.type === "validation" ? outcome.errors : getVisibleValidationErrors({ submission: true });
  if (postClickValidationErrors.length > 0) {
    appleSubmissionAttempts.set(submissionKey, { count, outcome: "rejected" });
    await reportAppleSubmitObservation(options, "rejected");
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
      submissionOutcome: "rejected",
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
      pending: false,
      pausedForReview: true,
      errorType: "clicked_but_unconfirmed",
      submissionOutcome: "unknown",
      summary: "Submit was clicked, but Apple is still processing and the outcome is unknown. Check Your Roles before retrying; Submit will not be clicked again."
    };
  }

  // Unanswered fields without an explicit rejection do not prove that the
  // server rejected Submit. Treat that ambiguous case as unknown, never retry.
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
    submissionOutcome: "unknown",
    summary:
      "Clicked final Submit, but couldn't confirm a success, already-applied, or still-loading signal afterward -- please check this application manually before assuming it went through."
  };
}

async function clickFinalSubmit(steps, options = {}) {
  const blocked = checkSubmissionPermission(options);
  if (blocked) return blocked;
  window.scrollTo(0, document.body.scrollHeight);
  await delay(500);

  const siteConfig = getSiteConfig();
  const alreadyAppliedBeforeSubmitSearch = getAlreadyAppliedSignal();

  if (alreadyAppliedBeforeSubmitSearch) {
    return buildAlreadyAppliedActionResult(alreadyAppliedBeforeSubmitSearch, steps);
  }

  let alreadyAppliedDuringSubmitSearch = null;
  const element = await waitForClickable(siteConfig?.finalSubmitPattern || /^submit$/i, 4000, {
    assertIdentity: options.assertIdentity,
    shouldStop: () => {
      alreadyAppliedDuringSubmitSearch = getAlreadyAppliedSignal();
      return Boolean(alreadyAppliedDuringSubmitSearch);
    }
  });

  if (!element) {
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

  return clickAndDetectSubmission(element, steps, options);
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
async function clickPrimaryAction(siteConfig, steps, options = {}) {
  const alreadyAppliedSignal = getAlreadyAppliedSignal();

  if (alreadyAppliedSignal) {
    return buildAlreadyAppliedActionResult(alreadyAppliedSignal, steps);
  }

  const primaryButton = findPrimaryActionButton(siteConfig);

  if (!primaryButton) {
    const submitResult = await clickFinalSubmit(steps, { ...options, recordMissing: false });

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
        assertIdentity: options.assertIdentity,
        assertOwnership: options.assertOwnership,
        assertSavedAnswers: options.assertSavedAnswers,
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
    return clickAndDetectSubmission(primaryButton, steps, options);
  }

  primaryButton.scrollIntoView({
    block: "center"
  });
  await delay(200);
  await options.assertOwnership?.();
  options.assertIdentity?.();
  if ((siteConfig?.finalSubmitPattern || /^submit$/i).test(getActionLabel(primaryButton))) {
    return clickAndDetectSubmission(primaryButton, steps, options);
  }
  await options.assertSavedAnswers?.();
  options.assertIdentity?.();
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
      return isVisaSponsorshipQuestion(text) &&
        isQuestionControlRequired(element, text);
    })
    .sort((a, b) => normalizeText(a.innerText || "").length - normalizeText(b.innerText || "").length);

  return containers[0] || null;
}

async function clickSponsorshipAnswer(steps, applicationAnswers = {}, options = {}) {
  const container = findSponsorshipContainer();
  return container ? answerSavedWorkQuestion(container, steps, applicationAnswers, options)
    : { answered: false };
}

function getSelectedWorkAnswer(container) {
  const selected = [];
  for (const select of Array.from(container.querySelectorAll("select"))) {
    const option = select.options?.[select.selectedIndex];
    if (option && !isPlaceholderOption(option)) selected.push(`${option.textContent || ""} ${option.value || ""}`);
  }
  for (const option of Array.from(container.querySelectorAll("input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox'], button, [role='button']"))) {
    if (isAnswerOptionSelected(option)) selected.push(getAnswerOptionLabel(option));
  }
  for (const control of Array.from(container.querySelectorAll("[role='combobox'], [aria-haspopup='listbox'], .ud__select__selector"))) {
    const value = normalizeText(control.value || control.innerText || "");
    if (value && !/^(?:select|choose)(?: an?)?(?: option| answer)?$/i.test(value)) selected.push(value);
  }
  const answers = selected.map(value => isYesAnswerText(value) ? "Yes" : isNoAnswerText(value) ? "No" : "unverified");
  return answers.length ? answers.every(value => value === answers[0]) ? answers[0] : "conflict" : null;
}

function getSavedApplicationQuestionText(container) {
  const declared = container?.getAttribute?.("data-form-field-i18n-name");
  if (declared) return normalizeText(declared);
  const legend = container?.querySelector?.("legend");
  if (legend?.tagName?.toLowerCase() === "legend" && legend.innerText) return normalizeText(legend.innerText);
  // Preserve question wording for exact saved answers, excluding rendered answer labels.
  const labels = new Set([
    ...getAgentOptionControls(container).map(getAnswerOptionLabel),
    ...Array.from(container?.querySelectorAll?.("select") || []).flatMap(select => Array.from(select.options || []).map(option => option.textContent || option.value || ""))
  ].map(normalizeText));
  const lines = String(container?.innerText || "").split(/\n/).map(normalizeText).filter(Boolean);
  while (lines.length > 1 && (labels.has(lines[lines.length - 1]) || /^(?:yes|no|edit)$/i.test(lines[lines.length - 1]))) lines.pop();
  return normalizeText(lines.join(" "));
}

async function answerSavedWorkQuestion(container, steps, applicationAnswers = {}, options = {}) {
  const questionText = getSavedApplicationQuestionText(container);
  const policy = CareerPeelerApplicationSafety.applicationQuestionPolicy(questionText, applicationAnswers);
  const step = `Saved application answer: ${questionText}`;
  const fail = reason => {
    steps.push({ step, status: "blocked", label: reason });
    return { answered: false, unresolvedReason: reason };
  };
  if (!policy || policy.error) return fail(policy?.error || "The personal question could not be identified. Review it manually.");
  if (!["Yes", "No"].includes(policy.desiredAnswer)) return fail("This question needs its explicit saved value verified against Apple. Review it manually.");
  const mayWrite = () => getSavedApplicationQuestionText(container) === questionText &&
    (!getSelectedWorkAnswer(container) || getSelectedWorkAnswer(container) === policy.desiredAnswer);
  const current = getSelectedWorkAnswer(container);
  if (current && current !== policy.desiredAnswer) {
    return fail("Apple's existing answer conflicts with the saved setting or cannot be verified. Review it manually; it was not changed.");
  }
  if (current === policy.desiredAnswer) {
    steps.push({ step, status: "verified", label: "Existing answer agrees with the explicit saved setting." });
    return { answered: true };
  }
  const matches = value => policy.desiredAnswer === "Yes" ? isYesAnswerText(value) : isNoAnswerText(value);
  const select = Array.from(container.querySelectorAll("select")).find(element => isElementVisible(element) && !isActionDisabled(element));
  if (select) {
    const option = Array.from(select.options).find(option => !option.disabled && matches(`${option.textContent || ""} ${option.value || ""}`));
    if (!option) return fail("Apple did not offer the explicit saved answer. Review this question manually.");
    await options.assertOwnership?.();
    options.assertIdentity?.();
    if (!mayWrite()) return fail("Apple changed the personal question or its existing answer. Review it manually; it was not changed.");
    setNativeFormValue(select, option.value);
  } else {
    let option = getAgentOptionControls(container).find(element => matches(getAnswerOptionLabel(element)));
    if (!option) {
      const control = container.querySelector("[role='combobox'], [aria-haspopup='listbox'], .ud__select__selector");
      if (!control) return fail("Apple did not expose a supported control for the saved answer. Review this question manually.");
      options.assertIdentity?.();
      const offered = await openAndReadAgentDropdownOptions(control, options);
      option = offered.find(element => matches(getAnswerOptionLabel(element)));
    }
    if (!option || option.isConnected === false || container.isConnected === false) return fail("Apple's answer control changed or did not offer the saved answer. Review it manually.");
    await options.assertOwnership?.();
    options.assertIdentity?.();
    if (!mayWrite()) return fail("Apple changed the personal question or its existing answer. Review it manually; it was not changed.");
    option.scrollIntoView({ block: "center" });
    option.click();
  }
  const verified = await waitForCondition(() => container.isConnected !== false &&
    getSavedApplicationQuestionText(container) === questionText && getSelectedWorkAnswer(container) === policy.desiredAnswer);
  if (!verified) return fail("The explicit saved answer could not be verified on Apple. Review it manually.");
  steps.push({ step, status: "selected", label: "Explicit saved answer selected and verified." });
  return { answered: true };
}

function isSavedPersonalQuestion(text, profile = {}) {
  return Boolean(CareerPeelerApplicationSafety.applicationQuestionPolicy(text, profile)) ||
    /\b(?:gender|race|ethnicity|veteran|disabilit(?:y|ies))\b/i.test(text);
}

function readSavedPersonalSelection(element, container, kind) {
  if (kind === "select") {
    return Array.from(element.selectedOptions || element.options || [])
      .filter(option => option.selected || element.options?.[element.selectedIndex] === option)
      .filter(option => !isPlaceholderOption(option))
      .map(option => normalizeText(option.textContent || option.value || ""));
  }
  if (kind === "open_text") return String(element.value || "").trim() ? [normalizeText(element.value)] : [];
  if (kind === "custom_dropdown") {
    const value = getSelectedDropdownText(container);
    return value && !/^(?:select|choose)(?: an?)?(?: option| answer| date)?$/i.test(value) ? [value] : [];
  }
  return getAgentOptionControls(container).filter(isAnswerOptionSelected).map(getAnswerOptionLabel).map(normalizeText);
}

function savedAnswersAgree(selected, expected, policy) {
  if (selected.length !== expected.length || !selected.length) return false;
  if (policy && ["Yes", "No"].includes(policy.desiredAnswer)) {
    return selected.length === 1 && (policy.desiredAnswer === "Yes" ? isYesAnswerText(selected[0]) : isNoAnswerText(selected[0]));
  }
  return selected.every(value => expected.some(answer => normalizeText(answer).toLowerCase() === value.toLowerCase()));
}

async function verifySavedApplicationAnswers(steps, options = {}, { readOnlyReview = false } = {}) {
  const fail = reason => {
    steps.push({ step: "Verify saved application answers", status: "blocked", label: reason });
    return { unresolvedReason: reason };
  };
  const records = [];
  const groups = new Set();
  for (const element of getRequiredFieldAuditControls()) {
    const kind = getRequiredFieldAuditKind(element);
    const container = getAgentFieldContainer(element);
    const label = getSavedApplicationQuestionText(container) || getApplicationControlQuestionLabel(element);
    if (!isSavedPersonalQuestion(label, options.applicationAnswers) || !shouldAgentAnswerRequiredControl(element, label, { includeUnmarked: true })) continue;
    if (groups.has(container)) continue;
    groups.add(container);
    records.push({ element, container, kind, label });
  }
  if (readOnlyReview) {
    // Use the existing semantic container reader, not guessed Apple review ids. A recognizable
    // question with no associated single answer is blocked instead of inferred from the profile.
    const reviewContainers = Array.from(document.querySelectorAll("fieldset, section, div, li"))
      .filter(element => isElementVisible(element))
      .map(element => {
        const lines = String(element.innerText || "").split(/\n/).map(normalizeText).filter(Boolean);
        const questions = lines.filter(line => isSavedPersonalQuestion(line, options.applicationAnswers) &&
          !isOptionalApplicationQuestion(element, line) &&
          (!isStartDateQuestion(line) || /\b(?:earliest|available|availability)\b|when can you start|\?/i.test(line)));
        return { element, lines, questions };
      })
      .filter(record => record.questions.length > 0)
      .filter(record => !records.some(editable => editable.container === record.element ||
        editable.container.contains?.(record.element) || record.element.contains?.(editable.element)));
    const candidates = reviewContainers.filter(record => record.questions.length === 1 && record.lines.join(" ").length <= 1000);
    const rows = candidates.filter(record => !candidates.some(other => other.element !== record.element && record.element.contains?.(other.element)));
    // A section can render several question/answer pairs in p/span children. Dropping that
    // section because it has more than one question would bypass every saved-answer check.
    // Require all recognized occurrences to belong to a verifiable row; ancestor containers
    // with individually readable child rows are covered without becoming duplicate records.
    for (const container of reviewContainers) {
      const covered = rows.filter(row => row.element === container.element || container.element.contains?.(row.element))
        .flatMap(row => row.questions);
      for (const question of container.questions) {
        const match = covered.indexOf(question);
        if (match === -1) return fail("Apple's review contains personal questions that cannot be associated with a single verified answer. Review this step manually; Submit was not clicked.");
        covered.splice(match, 1);
      }
    }
    for (const record of rows) {
      const label = record.questions[0];
      const index = record.lines.indexOf(label);
      const selected = record.lines.slice(index + 1).filter(line => !/^(?:edit|change|modify)$/i.test(line));
      records.push({ element: record.element, container: record.element, kind: "review", label, selected });
    }
  }
  const labelIsCurrent = record => record.kind === "review" ||
    (getSavedApplicationQuestionText(record.container) || getApplicationControlQuestionLabel(record.element)) === record.label;
  for (const record of records) {
    options.assertIdentity?.();
    const { element, container, kind, label } = record;
    const reviewText = kind === "review" ? String(element.innerText || "") : null;
    const policy = CareerPeelerApplicationSafety.applicationQuestionPolicy(label, options.applicationAnswers || {});
    if (policy?.error) return fail(policy.error);
    let selected = record.selected || readSavedPersonalSelection(element, container, kind);
    let expected;
    if (policy && ["Yes", "No"].includes(policy.desiredAnswer)) {
      expected = [policy.desiredAnswer];
    } else if (policy?.policyKey === "earliest_start_date" && kind === "open_text") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(policy.desiredAnswer)) return fail("Apple's date field needs an explicit saved calendar date. Review it manually.");
      expected = [policy.desiredAnswer];
    } else {
      let customOptions = [];
      if (kind === "custom_dropdown" && !selected.length) customOptions = await openAndReadAgentDropdownOptions(element, options);
      record.customOptions = customOptions;
      const offered = kind === "select" ? Array.from(element.options || []).filter(option => !isPlaceholderOption(option)).map(option => normalizeText(option.textContent || option.value || ""))
        : kind === "option_group" ? getAgentOptionControls(container).map(getAnswerOptionLabel)
          : customOptions.length ? customOptions.map(getAnswerOptionLabel) : selected;
      const decision = await requestApplicationQuestionDecision({ kind: kind === "review" ? "select" : kind, label, options: offered }, offered);
      expected = decision?.action === "choose_options" && Array.isArray(decision.value) ? decision.value
        : ["choose_option", "answer_text"].includes(decision?.action) ? [decision.value] : [];
      if (!expected.length) return fail("No explicit saved answer safely maps to this personal question. Review it manually; no answer was invented.");
    }
    options.assertIdentity?.();
    if (element.isConnected === false || container.isConnected === false || !labelIsCurrent(record) ||
        (kind === "review" && String(element.innerText || "") !== reviewText)) return fail("Apple changed the personal-answer row during verification. Review it manually.");
    selected = kind === "review" ? selected : readSavedPersonalSelection(element, container, kind);
    record.verifiedSelection = selected;
    record.reviewText = reviewText;
    if (selected.length) {
      if (!savedAnswersAgree(selected, expected, policy)) return fail("Apple's existing personal answer conflicts with the saved answer or cannot be verified. Review it manually; it was not changed.");
      continue;
    }
    if (kind === "review") return fail("Apple's read-only review does not expose a verifiable answer for this personal question. Review it manually.");
    const mayWrite = () => labelIsCurrent(record) && element.isConnected !== false && container.isConnected !== false &&
      readSavedPersonalSelection(element, container, kind).every(value => policy && ["Yes", "No"].includes(policy.desiredAnswer)
        ? (policy.desiredAnswer === "Yes" ? isYesAnswerText(value) : isNoAnswerText(value))
        : expected.some(answer => normalizeText(answer).toLowerCase() === value.toLowerCase()));
    if (kind === "select") {
      await options.assertOwnership?.(); options.assertIdentity?.();
      if (!mayWrite()) return fail("Apple changed the personal question or its existing answer. Review it manually; it was not changed.");
      if (!setNativeSelectValues(element, expected)) return fail("Apple did not offer the explicit saved personal answer. Review it manually.");
    } else if (kind === "open_text") {
      if (element.readOnly) return fail("The personal answer is read-only and could not be verified. Review it manually.");
      await options.assertOwnership?.(); options.assertIdentity?.();
      if (!mayWrite()) return fail("Apple changed the personal question or its existing answer. Review it manually; it was not changed.");
      setNativeFormValue(element, expected[0]);
    } else if (policy && ["Yes", "No"].includes(policy.desiredAnswer)) {
      const result = await answerSavedWorkQuestion(container, steps, options.applicationAnswers || {}, options);
      if (result.unresolvedReason) return fail(result.unresolvedReason);
    } else if (["option_group", "custom_dropdown"].includes(kind)) {
      const offered = kind === "option_group" ? getAgentOptionControls(container) : record.customOptions || [];
      const matched = expected.map(value => offered.find(option => getAnswerOptionLabel(option).toLowerCase() === normalizeText(value).toLowerCase()));
      if (matched.some(option => !option) || (kind === "custom_dropdown" && matched.length !== 1)) return fail("Apple did not expose the explicit saved answer. Review it manually.");
      for (const option of matched) {
        await options.assertOwnership?.(); options.assertIdentity?.();
        if (option.isConnected === false || !mayWrite()) return fail("Apple replaced or changed the personal-answer control. Review it manually.");
        option.click();
      }
    } else return fail("Apple's personal-answer control could not be verified. Review it manually.");
    const verified = await waitForCondition(() => element.isConnected !== false && container.isConnected !== false &&
      savedAnswersAgree(readSavedPersonalSelection(element, container, kind), expected, policy));
    if (!verified) return fail("The saved personal answer did not remain in Apple's form. Review it manually.");
    record.verifiedSelection = readSavedPersonalSelection(element, container, kind);
  }
  // An earlier field may have changed while a later saved-answer lookup was awaited.
  for (const record of records) {
    if (record.element.isConnected === false || record.container.isConnected === false || !labelIsCurrent(record) ||
        (record.kind === "review" ? String(record.element.innerText || "") !== record.reviewText :
          JSON.stringify(readSavedPersonalSelection(record.element, record.container, record.kind)) !== JSON.stringify(record.verifiedSelection))) {
      return fail("Apple changed a verified personal answer before navigation. Review it manually.");
    }
  }
  return { unresolvedReason: null };
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
  return CareerPeelerApplicationSafety.workQuestionPolicy(text)?.policyKey === "work_authorization";
}

function isCategoricalWorkAuthorizationStatusQuestion(text) {
  const lower = normalizeText(text || "").toLowerCase();
  return /\bright[\s\-‐‑‒–—]+to[\s\-‐‑‒–—]+work\s+status\b/.test(lower);
}

function isVisaSponsorshipQuestion(text) {
  return CareerPeelerApplicationSafety.workQuestionPolicy(text)?.policyKey === "sponsorship";
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
        isPriorAppleContractorQuestion(text) ||
        isCriminalHistoryQuestion(text);
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

async function selectNativeAnswer(container, stepName, steps, matchesAnswer, answerLabel, options = {}) {
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

    await options.assertOwnership?.();
    options.assertIdentity?.();
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

async function selectNativeYesAnswer(container, stepName, steps, options = {}) {
  return selectNativeAnswer(container, stepName, steps, isYesAnswerText, "Yes", options);
}

async function clickAnswerInContainer(container, answerPattern, stepName, steps, options = {}) {
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
    await options.assertOwnership?.();
    options.assertIdentity?.();
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

async function clickDropdownAnswer(container, stepName, steps, matchesAnswer, answerLabel, options = {}) {
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
    await options.assertOwnership?.();
    options.assertIdentity?.();
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
    await options.assertOwnership?.();
    options.assertIdentity?.();
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

async function clickDropdownYesAnswer(container, stepName, steps, options = {}) {
  return clickDropdownAnswer(container, stepName, steps, isYesAnswerText, "Yes", options);
}

function getSelectedDropdownText(container) {
  const selectorPattern = ".ud__select__selector, [role='combobox'], [aria-haspopup='listbox']";
  const inputPattern = "input[role='combobox'], input[readonly]";
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

async function answerYesQuestion(container, stepName, steps, options = {}) {
  if (await selectNativeYesAnswer(container, stepName, steps, options)) {
    return true;
  }

  if (await clickAnswerInContainer(container, /\byes\b/, stepName, steps, options)) {
    return true;
  }

  return clickDropdownYesAnswer(container, stepName, steps, options);
}

async function answerNoQuestion(container, stepName, steps, options = {}) {
  if (await selectNativeAnswer(container, stepName, steps, isNoAnswerText, "No", options)) {
    return true;
  }

  if (await clickAnswerInContainer(container, /\bno\b/, stepName, steps, options)) {
    return true;
  }

  return clickDropdownAnswer(container, stepName, steps, isNoAnswerText, "No", options);
}

async function answerQuestionnaire(steps, applicationAnswers = {}, options = {}) {
  const alreadyAppliedBeforeQuestions = getAlreadyAppliedSignal();

  if (alreadyAppliedBeforeQuestions) {
    return {
      answeredAny: false,
      requiredCount: 0,
      answeredCount: 0,
      alreadyAppliedSignal: alreadyAppliedBeforeQuestions
    };
  }

  const questionRules = [
    isWorkAuthorizationQuestion, isVisaSponsorshipQuestion, isAgeEligibilityQuestion,
    isPriorAppleEmploymentQuestion, isPriorAppleContractorQuestion, isCriminalHistoryQuestion
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

    const container = getQuestionContainers().find((candidate) => rule(getSavedApplicationQuestionText(candidate)));

    if (!container) {
      continue;
    }

    requiredCount += 1;

    options.assertIdentity?.();
    const result = await answerSavedWorkQuestion(container, steps, applicationAnswers, options);
    if (result.unresolvedReason) return { answeredAny: answeredCount > 0, requiredCount, answeredCount,
      alreadyAppliedSignal: null, unresolvedReason: result.unresolvedReason };
    if (result.answered) answeredCount += 1;
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

  const nativeRadios = getRequiredNativeRadioPeers(element);
  if (nativeRadios.length) return nativeRadios[0];

  return element?.closest?.(
    "[data-form-field-i18n-name], [data-form-field-id], .ud-formily-item, fieldset, [role='radiogroup'], [role='group']"
  ) || element;
}

function getRequiredNativeRadioPeers(element) {
  if (String(element?.type || "").toLowerCase() !== "radio" || !element.name) return [];
  // Apple may put each option in its own label without a fieldset. Native name
  // and form ownership identify the question even when no group wrapper exists.
  return Array.from(document.querySelectorAll("input[type='radio']"))
    .filter(option => option.name === element.name && option.form === element.form);
}

function isRequiredFieldAuditControlAnswered(element, kind, group) {
  if (kind === "select") {
    return !isPlaceholderOption(element.options?.[element.selectedIndex]);
  }

  if (kind === "custom_dropdown") {
    return hasMeaningfulSelectedDropdownValue(group || element);
  }

  if (kind === "option_group") {
    const peers = getRequiredNativeRadioPeers(element);
    if (peers.length) return peers.some(isAnswerOptionSelected);
    const options = Array.from(
      group?.querySelectorAll?.(
        "input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']"
      ) || [element]
    );
    if (!group || group === element || group.matches?.("input[type='radio'], input[type='checkbox'], [role='radio'], [role='checkbox']")) options.unshift(group || element);
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

async function openAndReadAgentDropdownOptions(control, options = {}) {
  const before = new Set(getVisibleAgentDropdownOptions());
  control.scrollIntoView({ block: "center" });
  await delay(150);
  await options.assertOwnership?.();
  options.assertIdentity?.();
  control.click();

  const deadline = Date.now() + 4000;
  let lastSignature = "";
  let stableChecks = 0;
  let bestCandidates = [];

  while (Date.now() < deadline) {
    options.assertIdentity?.();
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
    options.assertIdentity?.();
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
      optionElements = await openAndReadAgentDropdownOptions(descriptor.element, options);
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

    options.assertIdentity?.();
    let confirmed = false;
    if (["select", "multi_select"].includes(descriptor.kind)) {
      await options.assertOwnership?.();
      options.assertIdentity?.();
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
          await options.assertOwnership?.();
          options.assertIdentity?.();
          option.click();
        }
        confirmed = await waitForCondition(() => matched.every(isAnswerOptionSelected));
      }
    } else {
      confirmed = true;
      for (let valueIndex = 0; valueIndex < wantedValues.length; valueIndex += 1) {
        const wantedValue = wantedValues[valueIndex];
        const currentOptions = valueIndex === 0 ? optionElements : await openAndReadAgentDropdownOptions(descriptor.element, options);
        const option = currentOptions.find(
          (candidate) => getAnswerOptionLabel(candidate).toLowerCase() === wantedValue.toLowerCase()
        );
        if (!option) {
          confirmed = false;
          break;
        }
        option.scrollIntoView({ block: "nearest" });
        await options.assertOwnership?.();
        options.assertIdentity?.();
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

  await options.assertOwnership?.();
  options.assertIdentity?.();
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

function getJobIdentifiedSubmissionSignals() {
  const signals = [];
  for (const element of Array.from(document.querySelectorAll("#global-alert, [role='alert'], [data-autom='submission-confirmation']"))) {
    if (!isElementVisible(element)) continue;
    const text = normalizeText(element.innerText || element.textContent || "");
    if (!isSubmissionConfirmationText(text)) continue;
    const ids = new Set(Array.from(element.querySelectorAll?.('a[href*="/details/"]') || [])
      .map(anchor => CareerPeelerApplicationSafety.jobIdFromUrl(anchor.href)).filter(Boolean));
    for (const match of text.matchAll(/\b(?:job|role|requisition)\s*(?:id|number|#|:)\s*:?\s*(\d+(?:-\d+)?)/gi)) ids.add(match[1]);
    signals.push({ text, ids });
  }
  return signals;
}

function getJobBoundSubmissionSignal(expectedJobId) {
  const signal = getJobIdentifiedSubmissionSignals().find(signal => signal.ids.size === 1 && signal.ids.has(String(expectedJobId)));
  return signal ? { text: signal.text, jobId: String(expectedJobId) } : null;
}

function assertAppleWorkflowIdentity(options = {}, allowConfirmation = false) {
  const expected = String(options.expectedJobId || "");
  const url = window.location.href;
  if (!/^\d+(?:-\d+)?$/.test(expected)) throw Object.assign(new Error("The reviewed Apple job ID is missing or invalid. The workflow stopped."),
    { code: "job_identity_unverified" });
  if (getJobIdentifiedSubmissionSignals().some(signal => [...signal.ids].some(id => id !== expected))) {
    throw Object.assign(new Error("The submission confirmation identifies a different Apple role. The workflow stopped."),
      { code: "job_identity_mismatch" });
  }
  if (CareerPeelerApplicationSafety.matchesJob(expected, url)) return;
  // A profile route has no job identity. Accept it for observation only when
  // this workflow submitted and the confirmation itself identifies that role.
  if (allowConfirmation && options.allowConfirmation && CareerPeelerApplicationSafety.isConfirmationUrl(url) &&
    getJobBoundSubmissionSignal(expected)) return;
  const actual = CareerPeelerApplicationSafety.jobIdFromUrl(url);
  throw Object.assign(new Error(actual
    ? `Apple job identity changed: reviewed ${expected || "unknown"}, now ${actual}. The workflow stopped.`
    : "Apple job identity could not be verified. The workflow stopped; review the selected role and Your Roles manually."),
  { code: actual ? "job_identity_mismatch" : "job_identity_unverified" });
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

async function waitForApplicationFormToSettle(options = {}) {
  const timeoutMs = options.timeoutMs ?? 9000;
  const intervalMs = options.intervalMs ?? 200;
  const stableChecksRequired = options.stableChecksRequired ?? 5;
  const minimumWaitMs = options.minimumWaitMs ?? 0;
  const startedAt = Date.now();
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableCount = 0;
  const siteConfig = getSiteConfig();
  const applicationPage = Boolean(siteConfig?.isApplicationUrl(getCurrentUrl()));

  const countInteractiveElements = () =>
    document.querySelectorAll("[data-form-field-i18n-name], select, input, textarea, button, [role='button']")
      .length;

  while (Date.now() < deadline) {
    options.assertObservationIdentity?.();
    const alreadyAppliedSignal = getAlreadyAppliedSignal();

    if (alreadyAppliedSignal) {
      return { alreadyAppliedSignal };
    }

    const currentCount = countInteractiveElements();
    const applicationControlsPresent = !applicationPage || Boolean(document.getElementById(siteConfig.primaryActionId)) ||
      Boolean(findClickableByText(siteConfig.continuePattern || /^continue$/i)) ||
      Boolean(findClickableByText(siteConfig.finalSubmitPattern || /^submit$/i));

    if (applicationControlsPresent && currentCount > 0 && currentCount === lastCount) {
      stableCount += 1;
      if (stableCount >= stableChecksRequired && Date.now() - startedAt >= minimumWaitMs) {
        return { ready: true, alreadyAppliedSignal: null };
      }
    } else {
      stableCount = 0;
    }

    lastCount = currentCount;
    await delay(intervalMs);
  }

  return { ready: false, alreadyAppliedSignal: getAlreadyAppliedSignal() };
}

const revokedAppleWorkflows = new Set();
const executedAppleWorkflowSteps = new Set();

async function reportAppleSubmitObservation(options, submissionOutcome) {
  if (!options.workflowSessionId) return;
  (options.assertObservationIdentity || options.assertIdentity)?.();
  const reply = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_RECORD_WORKFLOW_SUBMIT_OUTCOME",
    workflowSessionId: options.workflowSessionId, workflowStepId: options.workflowStepId,
    expectedJobId: options.expectedJobId, identityVerified: true, submissionOutcome });
  if (!reply?.ok) throw Object.assign(new Error(reply?.error || "The Submit observation could not be saved."), { code: "workflow_owner_revoked" });
  (options.assertObservationIdentity || options.assertIdentity)?.();
}

async function assertAppleWorkflowOwnership(options, action = "form") {
  const assertLive = () => {
    if (revokedAppleWorkflows.has(options.workflowSessionId)) {
      throw Object.assign(new Error("The application owner was stopped or restarted."), { code: "workflow_owner_revoked" });
    }
    options.assertIdentity?.();
  };
  assertLive();
  const reply = await chrome.runtime.sendMessage({ type: "APPLE_CAREERS_AUTHORIZE_WORKFLOW_ACTION", action,
    workflowSessionId: options.workflowSessionId, workflowStepId: options.workflowStepId,
    expectedJobId: options.expectedJobId });
  if (!reply?.ok) throw Object.assign(new Error(reply?.error || "Application ownership could not be verified."),
    { code: "workflow_owner_revoked" });
  if (action === "submit") options.submitPermissionGranted = true;
  assertLive();
}

async function runApplicationWorkflowStep(options = {}) {
  const steps = [];
  const bound = { ...options, steps };
  bound.assertIdentity = () => assertAppleWorkflowIdentity(bound);
  if (bound.workflowSessionId) bound.assertOwnership = action => assertAppleWorkflowOwnership(bound, action);
  bound.assertSavedAnswers = async () => {
    const config = getSiteConfig();
    const primary = findPrimaryActionButton(config);
    const readOnlyReview = Boolean(primary) && (config?.finalSubmitPattern || /^submit$/i).test(getActionLabel(primary)) &&
      !hasVisibleApplicationQuestionControls();
    const audit = await verifySavedApplicationAnswers(steps, bound, { readOnlyReview });
    if (audit.unresolvedReason) throw Object.assign(new Error(audit.unresolvedReason), { code: "workflow_saved_answer_unresolved" });
  };
  bound.assertObservationIdentity = () => assertAppleWorkflowIdentity({ ...bound,
    allowConfirmation: Boolean(bound.allowConfirmation || steps.some(step => step.step === "Submit application" && step.status === "clicked")) }, true);
  try {
    bound.assertObservationIdentity();
    const result = await runBoundApplicationWorkflowStep(bound);
    bound.assertObservationIdentity();
    return { ...result, expectedJobId: String(bound.expectedJobId), identityVerified: true };
  } catch (error) {
    if (!/^(job_identity_|workflow_)/.test(error.code || "")) throw error;
    const unknown = bound.submitPermissionGranted || bound.submissionOutcome === "unknown" || steps.some(step => step.step === "Submit application" && step.status === "clicked");
    return buildStepResult({ clicked: false, done: false, pausedForReview: true,
      errorType: error.code, steps, expectedJobId: String(bound.expectedJobId || ""), identityVerified: false,
      submissionOutcome: unknown ? "unknown" : bound.submissionOutcome || "not_attempted", summary: error.message });
  }
}

async function runBoundApplicationWorkflowStep(options) {
  const steps = options.steps;
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
    const submitResume = await waitForJobSpecificApplyAction(siteConfig, jobId, 6000, options);
    options.assertIdentity();

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
      if (!CareerPeelerApplicationSafety.matchesJob(options.expectedJobId, backgroundOpenableLink)) {
        throw Object.assign(new Error("The application link did not identify the reviewed Apple role."), { code: "job_identity_mismatch" });
      }
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
    await options.assertOwnership?.();
    options.assertIdentity();
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
  const submittedOnLoad = CareerPeelerApplicationSafety.matchesJob(options.expectedJobId, window.location.href)
    ? getSubmittedSignal() : getJobBoundSubmissionSignal(options.expectedJobId);

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

  const settleResult = await waitForApplicationFormToSettle({
    minimumWaitMs: 0, assertObservationIdentity: options.assertObservationIdentity
  });
  options.assertObservationIdentity();

  if (settleResult.alreadyAppliedSignal) {
    return buildAlreadyAppliedStepResult(settleResult.alreadyAppliedSignal, steps);
  }

  if (settleResult.ready === false) {
    return buildStepResult({ clicked: false, done: false, pausedForReview: true,
      errorType: "application_not_ready", steps,
      summary: "Apple's application form did not finish loading its Continue/Submit controls. Open the application to review it manually." });
  }
  steps.push({ step: "Read application step", status: "detected",
    label: normalizeText(document.querySelector("h1")?.innerText || "Application") });

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
    const questionnaireResult = await answerQuestionnaire(steps, options.applicationAnswers, options);
    if (questionnaireResult.unresolvedReason) return buildStepResult({ clicked: false, done: false, pausedForReview: true,
      errorType: "work_eligibility_unresolved", steps, summary: questionnaireResult.unresolvedReason });

    if (questionnaireResult.alreadyAppliedSignal) {
      return buildAlreadyAppliedStepResult(questionnaireResult.alreadyAppliedSignal, steps);
    }

    answeredQuestionnaire = questionnaireResult.answeredAny;

    const alreadyAppliedBeforeFallback = getAlreadyAppliedSignal();

    if (alreadyAppliedBeforeFallback) {
      return buildAlreadyAppliedStepResult(alreadyAppliedBeforeFallback, steps);
    }

    const sponsorshipResult = answeredQuestionnaire ? { answered: false }
      : await clickSponsorshipAnswer(steps, options.applicationAnswers, options);
    if (sponsorshipResult.unresolvedReason) return buildStepResult({ clicked: false, done: false, pausedForReview: true,
      errorType: "work_eligibility_unresolved", steps, summary: sponsorshipResult.unresolvedReason });
    answeredSponsorship = sponsorshipResult.answered;

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

  options.assertIdentity();
  const savedAnswerAudit = await verifySavedApplicationAnswers(steps, options, { readOnlyReview: isReviewAndSubmitStep });
  if (savedAnswerAudit.unresolvedReason) return buildStepResult({ clicked: false, done: false, pausedForReview: true,
    errorType: "saved_application_answer_unresolved", steps, summary: savedAnswerAudit.unresolvedReason });
  const primaryActionResult = await clickPrimaryAction(siteConfig, steps, options);

  if (
    !primaryActionResult.clicked &&
    !primaryActionResult.done &&
    !primaryActionResult.pending &&
    !primaryActionResult.pausedForReview
  ) {
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
      ...options,
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
        submissionOutcome: "rejected",
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
      ...options,
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
        submissionOutcome: primaryActionResult.submissionOutcome,
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
        submissionOutcome: primaryActionResult.submissionOutcome,
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
      submissionOutcome: primaryActionResult.submissionOutcome,
      summary: primaryActionResult.summary
    });
  }

  if (primaryActionResult.pending) {
    return buildStepResult({
      clicked: true,
      done: false,
      steps,
      submissionOutcome: primaryActionResult.submissionOutcome,
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
      submissionOutcome: primaryActionResult.submissionOutcome,
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
  if (message?.type === "APPLE_CAREERS_REVOKE_WORKFLOW") {
    revokedAppleWorkflows.add(message.workflowSessionId);
    sendResponse({ ok: true, workflowSessionId: message.workflowSessionId });
    return true;
  }
  if (message?.type === "APPLE_CAREERS_VERIFY_WORKFLOW_IDENTITY") {
    try {
      assertAppleWorkflowIdentity(message, true);
      sendResponse({ ok: true, data: { identityVerified: true, expectedJobId: String(message.expectedJobId), url: window.location.href } });
    } catch (error) {
      sendResponse({ ok: false, error: error.message, data: { errorType: error.code } });
    }
    return false;
  }
  if (message?.type === "APPLE_CAREERS_LOCAL_MATCH_POSTING") {
    const details = message.details || {};
    let text = [details.title, "Description", details.description, "Minimum Qualifications", details.minimumQualifications,
      "Preferred Qualifications", details.preferredQualifications].filter(Boolean).join("\n\n");
    for (const qualification of message.nonScoringWorkflowQualifications || []) {
      if (typeof qualification === "string" && qualification) text = text.split(qualification).join(" ");
    }
    sendResponse({ ok: true, data: analyzeLocalMatch(text, [], message.resumeProfileText || "") });
    return false;
  }
  if (message?.type === "APPLE_CAREERS_GET_SUBMITTED_HISTORY_PAGE") {
    try {
      sendResponse({ ok: true, data: collectCurrentAppleSubmittedHistoryPage() });
    } catch (error) {
      sendResponse({ ok: false, error: error?.message || "Could not read this Apple submissions page." });
    }
    return true;
  }

  if (message?.type === "APPLE_CAREERS_PEEK_SUBMITTED_HISTORY_PAGE") {
    const session = getSessionRequiredSignal();
    if (session) { sendResponse({ ok: false, error: session }); return false; }
    try { assertAppleActiveSubmittedRolesPage(); }
    catch (_) { sendResponse({ ok: true, data: { activeContext: false } }); return false; }
    try { sendResponse({ ok: true, data: collectCurrentAppleSubmittedHistoryPage() }); }
    catch (error) { sendResponse({ ok: false, error: error.message }); }
    return false;
  }

  if (message?.type === "APPLE_CAREERS_SET_SUBMITTED_HISTORY_PAGE") {
    goToAppleSubmittedHistoryPage(message.pageIndex)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not open the Apple submissions page." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_GET_STABLE_SUBMITTED_HISTORY_INVENTORY") {
    Promise.resolve().then(async () => {
      if (message.openActive) await openAppleActiveSubmissionsForInventory();
      return collectStableAppleSubmittedHistoryInventory({ notBefore: Number.isFinite(message.notBefore) ? message.notBefore : Date.now() });
    }).then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error?.message || "Apple's complete stable inventory is unavailable." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_GET_ALL_SUBMITTED_HISTORY_PAGES") {
    collectAllAppleSubmittedHistoryPages({ restoreFirstPage: message.restoreFirstPage !== false, restoreOriginalPage: message.restoreOriginalPage === true })
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not refresh all Apple submissions." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_ADVANCE_SUBMITTED_HISTORY_PAGE") {
    advanceAppleSubmittedHistoryPage()
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not advance Apple submissions." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_WITHDRAW_SUBMITTED_ROLES") {
    Promise.resolve().then(() => withdrawAppleSubmittedRoles(message.roles || [], message.expectedPageIndex, message))
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not withdraw selected Apple roles." }));
    return true;
  }

  if (["APPLE_CAREERS_PREPARE_WITHDRAWAL_CLICK", "APPLE_CAREERS_FINISH_WITHDRAWAL_CLICK", "APPLE_CAREERS_GET_WITHDRAWAL_STATUS", "APPLE_CAREERS_REVOKE_WITHDRAWAL"].includes(message?.type)) {
    Promise.resolve().then(async () => {
      const operation = findAppleWithdrawalOperation(message);
      if (message.type === "APPLE_CAREERS_GET_WITHDRAWAL_STATUS") return getAppleWithdrawalStatus(message);
      if (message.type === "APPLE_CAREERS_REVOKE_WITHDRAWAL") {
        operation.guard.invalidate("The reviewed withdrawal batch was cancelled.");
        return { cancelled: true };
      }
      if (operation.finished) throw new Error("This withdrawal action has already finished.");
      if (message.type === "APPLE_CAREERS_PREPARE_WITHDRAWAL_CLICK") {
        if (message.expectedPageIndex !== operation.pageIndex) throw new Error("The withdrawal page changed.");
        return operation.guard.prepare(message.stage);
      }
      return operation.guard.finish(message.stage);
    }).then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error?.message || "The bound withdrawal action is unavailable." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_CHECK_SUBMITTED_ROLE_STATUS") {
    checkAppleSubmittedRoleStatus(
      message.jobId,
      message.title,
      message.expectedPageIndex,
      message.beforeCount,
      message.hadNextPage
    )
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Could not verify this Apple submission." }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_READ_RECOVERY_SUBMISSION_STATUS") {
    readAppleRecoverySubmissionStatus(message.expectedJobId, message.requestId, message.notBefore)
      .then(data => sendResponse({ ok: true, data }))
      .catch(error => sendResponse({ ok: false, error: error.message, data: { errorType: error.code } }));
    return true;
  }

  if (message?.type === "APPLE_CAREERS_EXTRACT_JOB") {
    if (message.verifyApplicability) {
      readAppleJobApplicability(message.expectedJobId).then(data => sendResponse({ ok: true, data }))
        .catch(error => sendResponse({ ok: false, error: error.message, data: { errorType: error.code } }));
      return true;
    }
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
    if (!message.workflowSessionId || !message.workflowStepId || executedAppleWorkflowSteps.has(message.workflowStepId)) {
      sendResponse({ ok: false, error: "A unique active application owner is required." });
      return true;
    }
    executedAppleWorkflowSteps.add(message.workflowStepId);
    runApplicationWorkflowStep({
      workflowSessionId: message.workflowSessionId,
      workflowStepId: message.workflowStepId,
      expectedJobId: message.expectedJobId,
      allowConfirmation: message.allowConfirmation,
      applicationAnswers: message.applicationAnswers,
      submissionOutcome: message.submissionOutcome,
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
    const ready = message.verifySearchPagination
      ? waitForVerifiedAppleSearchPage(message)
      : waitForJobListToSettle();
    ready.then((verified) => {
      const links = verified?.links || collectJobLinks();
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
          currentPage: verified?.currentPage || getCurrentResultsPage(),
          ...(verified ? { pageCount: verified.pageCount, paginationVerified: true } : {}),
          currentJob,
          links,
          listStats: getJobListStats(links),
          hasNextPage: verified ? verified.hasNextPage : Boolean(getNextPageControl())
        }
      });
    }).catch((error) => sendResponse({ ok: false, error: error?.message || "The Apple search page could not be read.",
      reason: error?.message, data: { errorType: error?.errorType || "search_page_read_failed", retryable: error?.retryable !== false } }));

    return true;
  }

  if (message?.type === "APPLE_CAREERS_GO_TO_NEXT_PAGE") {
    goToNextPage(message).then(sendResponse).catch(error => sendResponse({ ok: false,
      error: error?.message || "Apple's next search page could not be opened.", reason: error?.message,
      data: { errorType: error?.errorType || "search_page_navigation_failed", retryable: error?.retryable !== false } }));
    return true;
  }

  return false;
});


if (document.body && chrome.runtime?.id && getSiteConfig()?.id === "apple") {
  let observedId = null;
  let observationTimer = null;
  let lastCapacitySignature = null;
  let lastCapacityRequestAt = 0;
  const observe = () => {
    observationTimer = null;
    if (!chrome.runtime?.id) return;
    if (/^\/app\/[^/]+\/profile\/roles\/?$/i.test(window.location.pathname)) {
      try {
        const page = collectCurrentAppleSubmittedHistoryPage();
        const signature = `${page.pageIndex}|${page.pageCount}|${page.roles.map(role => role.jobId).join("|")}`;
        if (signature !== lastCapacitySignature || Date.now() - lastCapacityRequestAt >= 60000) {
          lastCapacitySignature = signature;
          lastCapacityRequestAt = Date.now();
          chrome.runtime.sendMessage({ type: "APPLE_CAREERS_CHECK_SUBMISSION_CAPACITY", signature }).catch(() => {});
        }
      } catch (_) { /* A route alone does not prove a ready Active list. */ }
    } else {
      lastCapacitySignature = null;
    }
    const jobId = getJobId();
    if (isSupportedJobDetailUrl(getCurrentUrl()) && jobId && observedId !== jobId) {
      const submittedAction = Array.from(document.querySelectorAll("a, button, [role='button']")).find(element =>
        isElementVisible(element) && /^submitted(?:\s*:|\s*$)/i.test(normalizeText(element.innerText || element.getAttribute("aria-label") || "")));
      if (submittedAction) {
        chrome.runtime.sendMessage({ type: "APPLE_CAREERS_OBSERVED_SUBMISSION", jobId, title: getJobTitle() }).then(result => {
          if (result?.ok && !result.deferred) observedId = jobId;
        }).catch(() => {});
      }
    }
  };
  const schedule = () => { if (!observationTimer) observationTimer = setTimeout(observe, 1000); };
  new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, characterData: true });
  schedule();
}
