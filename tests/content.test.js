const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const contentPath = path.join(__dirname, "..", "content.js");
const source = fs.readFileSync(contentPath, "utf8");

const sandbox = {
  URL,
  console,
  chrome: {
    runtime: {
      onMessage: {
        addListener() {}
      }
    }
  },
  document: {
    body: { innerText: "" },
    title: "",
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    getElementById() {
      return null;
    }
  },
  window: {
    location: {
      href: "https://jobs.apple.com/en-us/search",
      pathname: "/en-us/search",
      search: ""
    },
    getComputedStyle() {
      return {
        visibility: "visible",
        display: "block"
      };
    }
  }
};

vm.runInNewContext(
  `${source}
globalThis.__contentTestApi = {
  analyzeLocalMatch,
  classifyRole,
  cleanTitle,
  extractExperienceMatches,
  getJobIdFromUrl,
  isAgeEligibilityQuestion,
  isAnswerControlElement,
  isEssayQuestionLabel,
  isInternshipTitle,
  isNonAnswerAction,
  isNoAnswerText,
  isPriorAppleContractorQuestion,
  isPriorAppleEmploymentQuestion,
  isSupportedJobDetailUrl,
  isVisaSponsorshipQuestion,
  isWorkAuthorizationQuestion,
  isYesAnswerText,
  parseYears,
  textIncludesTerm
};`,
  sandbox,
  { filename: "content.js" }
);

const {
  analyzeLocalMatch,
  classifyRole,
  cleanTitle,
  extractExperienceMatches,
  getJobIdFromUrl,
  isAgeEligibilityQuestion,
  isAnswerControlElement,
  isEssayQuestionLabel,
  isInternshipTitle,
  isNonAnswerAction,
  isNoAnswerText,
  isPriorAppleContractorQuestion,
  isPriorAppleEmploymentQuestion,
  isSupportedJobDetailUrl,
  isVisaSponsorshipQuestion,
  isWorkAuthorizationQuestion,
  isYesAnswerText,
  parseYears,
  textIncludesTerm
} = sandbox.__contentTestApi;

function classify(title, description, userYearsOfExperience, noMatchKeywords) {
  const combinedText = `${title}\n${description}`;
  const matches = extractExperienceMatches(combinedText);
  const matchScore = analyzeLocalMatch(combinedText, noMatchKeywords);
  return {
    ...classifyRole(matches, matchScore, title, userYearsOfExperience),
    matchScore
  };
}

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("parses numeric and word-based years", () => {
  assert.deepEqual(Array.from(parseYears("Requires 2+ years of software experience")), [2]);
  assert.deepEqual(Array.from(parseYears("Requires three years of engineering experience")), [3]);
});

test("matches exact technical terms without substring false positives", () => {
  assert.equal(textIncludesTerm("We use JavaScript and React", "JavaScript"), true);
  assert.equal(textIncludesTerm("This role uses TypeScript", "Java"), false);
});

test("cleans Apple Careers title suffixes", () => {
  assert.equal(
    cleanTitle("Software QA Engineer, Creativity Apps - Jobs - Careers at Apple"),
    "Software QA Engineer, Creativity Apps"
  );
});

test("extracts Apple role id from details URL", () => {
  assert.equal(
    getJobIdFromUrl("https://jobs.apple.com/en-us/details/200637724-0836/software-qa-engineer?team=SFTWR"),
    "200637724-0836"
  );
});

test("extracts TikTok and ByteDance role ids from details URLs", () => {
  assert.equal(
    getJobIdFromUrl("https://careers.tiktok.com/position/7391234567890123456/detail"),
    "7391234567890123456"
  );
  assert.equal(
    getJobIdFromUrl("https://jobs.bytedance.com/en/position/7391234567890123456/detail"),
    "7391234567890123456"
  );
  assert.equal(
    getJobIdFromUrl("https://lifeattiktok.com/resume/7538573630772726034/apply"),
    "7538573630772726034"
  );
  assert.equal(
    getJobIdFromUrl("https://lifeattiktok.com/search/7278068779270408508"),
    "7278068779270408508"
  );
});

test("extracts generic career role ids from query parameters", () => {
  assert.equal(
    getJobIdFromUrl("https://careers.tiktok.com/search?job_id=ABC-123"),
    "ABC-123"
  );
});

test("recognizes TikTok search detail links but not application links as result cards", () => {
  assert.equal(isSupportedJobDetailUrl(new URL("https://lifeattiktok.com/search/7278068779270408508")), true);
  assert.equal(isSupportedJobDetailUrl(new URL("https://lifeattiktok.com/search?keyword=ml")), false);
  assert.equal(isSupportedJobDetailUrl(new URL("https://lifeattiktok.com/resume/7278068779270408508/apply")), false);
  assert.equal(isSupportedJobDetailUrl(new URL("https://careers.tiktok.com/position/application")), false);
  assert.equal(isSupportedJobDetailUrl(new URL("https://careers.tiktok.com/position/7278068779270408508/detail")), true);
});

test("recognizes joinbytedance.com as a supported ByteDance careers host", () => {
  assert.equal(
    isSupportedJobDetailUrl(
      new URL(
        "https://joinbytedance.com/search?keyword=software+engineer&recruitment_id_list=1&job_category_id_list=&subject_id_list=&location_code_list=CT_159%2CCT_93&limit=12&offset=0"
      )
    ),
    false
  );
  assert.equal(isSupportedJobDetailUrl(new URL("https://joinbytedance.com/search/7278068779270408508")), true);
  assert.equal(
    getJobIdFromUrl("https://joinbytedance.com/search/7278068779270408508"),
    "7278068779270408508"
  );
});

test("recognizes TikTok work authorization and sponsorship questions", () => {
  assert.equal(
    isWorkAuthorizationQuestion("Are you legally authorized to work in the US without restriction?"),
    true
  );
  assert.equal(
    isVisaSponsorshipQuestion("Will you now or in the future require visa sponsorship or a visa transfer?"),
    true
  );
});

test("selects only affirmative yes answer labels", () => {
  assert.equal(isYesAnswerText("Yes"), true);
  assert.equal(isYesAnswerText("Yes, I am authorized"), true);
  assert.equal(isYesAnswerText("No"), false);
  assert.equal(isYesAnswerText("Prefer not to answer"), false);
});

test("selects only negative no answer labels", () => {
  assert.equal(isNoAnswerText("No"), true);
  assert.equal(isNoAnswerText("No, I have not"), true);
  assert.equal(isNoAnswerText("Yes"), false);
  assert.equal(isNoAnswerText("Prefer not to answer"), false);
});

test("recognizes Apple age eligibility and prior employment screening questions", () => {
  assert.equal(isAgeEligibilityQuestion("Are you 18 years of age or older?"), true);
  assert.equal(
    isPriorAppleEmploymentQuestion("Have you ever been employed by Apple?"),
    true
  );
  assert.equal(
    isPriorAppleContractorQuestion(
      "Have you ever worked for Apple as a temporary agency worker, consultant, or an independent contractor?"
    ),
    true
  );
  assert.equal(isAgeEligibilityQuestion("Will you now or in the future require visa sponsorship?"), false);
  assert.equal(isPriorAppleEmploymentQuestion("Are you legally authorized to work in the United States?"), false);
});

test("hard-skips senior titles even with strong technical overlap", () => {
  const result = classify(
    "Senior Software Engineer",
    "Build backend APIs with C# .NET, AWS, DynamoDB, SQS, EventBridge, and Terraform."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /senior-level/i);
});

test("hard-skips manager titles even with strong technical overlap", () => {
  const result = classify(
    "Software Engineering Manager, Apple Services Engineering",
    "Build backend APIs, microservices, AWS systems, DynamoDB, queues, and distributed services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /senior-level/i);
});

test("hard-skips internship titles even with strong technical overlap", () => {
  const result = classify(
    "Software Engineering Internship, 2026",
    "Build backend APIs, microservices, AWS systems, DynamoDB, queues, and distributed services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /internship/i);

  const pluralResult = classify(
    "AIML - Summer Intern",
    "Build backend APIs, microservices, AWS systems, DynamoDB, queues, and distributed services."
  );

  assert.equal(pluralResult.decision, "Likely skip");
  assert.match(pluralResult.reason, /internship/i);
});

test("recognizes internship titles without matching substrings like 'International'", () => {
  assert.equal(isInternshipTitle("Software Engineering Internship, 2026"), true);
  assert.equal(isInternshipTitle("AIML - Summer Intern"), true);
  assert.equal(isInternshipTitle("Interns Program Coordinator"), true);
  assert.equal(isInternshipTitle("International Software Engineer"), false);
  assert.equal(isInternshipTitle("Internal Tools Engineer"), false);
});

test("recognizes plural 'Internships' titles", () => {
  // \bintern(s|ship)?\b previously missed "Internships" -- neither "s" nor "ship" alone
  // leaves a word boundary before the trailing "s" in "...ships".
  assert.equal(isInternshipTitle("Engineering Program Management Undergrad Internships"), true);
  assert.equal(isInternshipTitle("Software Engineering Internships, 2026"), true);
});

test("hard-skips jobs matching user-defined no-match keywords, before any other scoring", () => {
  const result = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, DynamoDB, and full-stack services.",
    2,
    ["machine learning", "embedded"]
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /no-match keyword list/i);
  assert.deepEqual(result.matchScore.noMatchKeywordHits, ["machine learning"]);
});

test("does not hard-skip on no-match keywords when none are configured or none match", () => {
  const withoutKeywords = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, DynamoDB, and full-stack services."
  );
  assert.notEqual(withoutKeywords.decision, "Likely skip");

  const withNonMatchingKeywords = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, DynamoDB, and full-stack services.",
    2,
    ["embedded", "firmware"]
  );
  assert.notEqual(withNonMatchingKeywords.decision, "Likely skip");
});

test("does not hard-skip on a no-match keyword that only appears under Preferred Qualifications", () => {
  const result = classify(
    "Software Development Engineer",
    "Minimum Qualifications: Build backend APIs and microservices using AWS and DynamoDB.\n" +
      "Preferred Qualifications: Experience with machine learning is a plus.",
    2,
    ["machine learning"]
  );

  assert.notEqual(result.decision, "Likely skip");
  assert.deepEqual(result.matchScore.noMatchKeywordHits, []);
});

test("still hard-skips on a no-match keyword that appears in Minimum Qualifications, even if also mentioned under Preferred", () => {
  const result = classify(
    "Software Development Engineer",
    "Minimum Qualifications: Experience with machine learning and backend APIs.\n" +
      "Preferred Qualifications: Deeper machine learning research experience is a plus.",
    2,
    ["machine learning"]
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /no-match keyword list/i);
  assert.deepEqual(result.matchScore.noMatchKeywordHits, ["machine learning"]);
});

test("still hard-skips on a no-match keyword in unlabeled text with no section headers at all", () => {
  const result = classify(
    "Software Development Engineer",
    "Build backend APIs and microservices using machine learning, AWS, and DynamoDB.",
    2,
    ["machine learning"]
  );

  assert.equal(result.decision, "Likely skip");
  assert.deepEqual(result.matchScore.noMatchKeywordHits, ["machine learning"]);
});

test("skips iOS app roles with Swift/UIKit/Xcode mismatch", () => {
  const result = classify(
    "iOS Software Engineer",
    "Develop iOS applications using Swift, UIKit, SwiftUI, Objective-C, and Xcode."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /domain mismatch|senior-level/i);
});

test("does not penalize bare Swift/macOS mentions without app-framework signals", () => {
  const result = classify(
    "Software Development Engineer",
    "Designing, programming, debugging and modifying software related to a cloud-based macOS application. Coding in Swift to develop the back-end for a testing tool, using SQL to query Postgres databases, and applying machine learning for data insights."
  );

  assert.notEqual(result.decision, "Likely skip");
  assert.equal(result.matchScore.domainMismatches.length, 0);
});

test("treats a missing years-of-experience requirement as satisfied when local fit score is strong", () => {
  const result = classify(
    "Software Development Engineer",
    "Designing, programming, debugging and modifying software related to a cloud-based macOS application. Coding in Swift to develop the back-end for a testing tool, using SQL to query Postgres databases, and applying machine learning for data insights. Master's degree in Computer Science or a related field."
  );

  assert.equal(result.decision, "Likely match");
  assert.equal(result.requiredYears, null);
  assert.match(result.reason, /treated as met/i);
});

test("keeps backend and full-stack roles eligible", () => {
  const result = classify(
    "Software Engineer, Backend Services",
    "Build backend APIs and microservices using C# .NET, AWS Lambda, SQS queues, EventBridge, DynamoDB, Terraform, SQL, and Angular web tools."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("Backend/API Engineering"));
});

test("keeps AI experience roles eligible from title and AI signals", () => {
  const result = classify(
    "Software Engineer - AI Experiences",
    "Build AI product experiences using Python, machine learning, LLMs, embeddings, APIs, and production services."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("AI Product Experiences"));
});

test("keeps Gen AI software engineer roles eligible", () => {
  const result = classify(
    "Gen AI Software Engineer",
    "Build generative AI and machine learning systems using Python, LLMs, embeddings, APIs, and production software services."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("AI Product Experiences"));
});

test("keeps LLM AIOps and data center networking roles eligible", () => {
  const result = classify(
    "LLM AIOps Development Engineer - Data Center Networking",
    "Build an AIOps observability platform with Python, machine learning, LLM agents, RAG, APIs, microservices, distributed data pipelines, monitoring, and automated remediation."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("LLMs"));
  assert.ok(result.matchScore.keywords.includes("Cloud Infrastructure"));
});

test("keeps QA automation roles eligible", () => {
  const result = classify(
    "Software QA Engineer, Creativity Apps",
    "Create test automation, integration testing, API validation, Jasmine tests, MSTest coverage, and quality assurance tooling."
  );

  assert.ok(["Likely match", "Review"].includes(result.decision));
  assert.ok(result.matchScore.keywords.includes("QA/Test Automation"));
});

test("skips high required years of experience", () => {
  const result = classify(
    "Software Engineer",
    "Minimum qualifications include 5+ years of professional software engineering experience with backend services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /exceed your 2 years/i);
});

test("skips high YOE bullets under minimum qualification headings", () => {
  const result = classify(
    "Software Engineer",
    "Minimum Qualifications\n10+ years of industry experience building large-scale software systems.\nExperience building backend APIs and distributed services."
  );

  assert.equal(result.decision, "Likely skip");
  assert.equal(result.requiredYears, 10);
  assert.match(result.reason, /exceed your 2 years/i);
});

test("skips high YOE when qualification headings are flattened into one block", () => {
  const result = classify(
    "ML Infrastructure Engineer",
    [
      "Description Architect scalable ML serving infrastructure supporting dynamic model sharding, load balancing, and fault tolerance.",
      "Minimum Qualifications 10+ years of experience in GPU programming CUDA ROCm and high-performance computing, successfully optimizing large-scale parallel workloads.",
      "Strong experience with inter-node communication technologies InfiniBand RDMA NCCL in the context of ML training/inference.",
      "Preferred Qualifications Python is a plus."
    ].join(" ")
  );

  assert.equal(result.decision, "Likely skip");
  assert.equal(result.requiredYears, 10);
  assert.match(result.reason, /exceed your 2 years/i);
});

test("skips very high non-preferred YOE even if section context is lost", () => {
  const result = classify(
    "ML Infrastructure Engineer",
    "10+ years of experience in GPU programming CUDA ROCm and high-performance computing. Build distributed inference systems with PyTorch and large-scale ML infrastructure."
  );

  assert.equal(result.decision, "Likely skip");
  assert.equal(result.requiredYears, 10);
  assert.match(result.reason, /high years-of-experience signal/i);
});

test("uses user-provided years of experience for required YOE", () => {
  const result = classify(
    "Software Engineer",
    "Minimum qualifications include 3+ years of professional software engineering experience with backend services, APIs, AWS, and queues.",
    4
  );

  assert.notEqual(result.decision, "Likely skip");
});

test("does not hard-skip preferred years alone", () => {
  const result = classify(
    "Backend Software Engineer",
    "Preferred Qualifications\n5+ years of experience.\nBuild APIs, services, queues, AWS systems, and DynamoDB-backed microservices."
  );

  assert.notEqual(result.decision, "Likely skip");
});

test("does not hard-skip high preferred years alone", () => {
  const result = classify(
    "Backend Software Engineer",
    "Preferred Qualifications\n10+ years of experience.\nBuild APIs, services, queues, AWS systems, and DynamoDB-backed microservices."
  );

  assert.notEqual(result.decision, "Likely skip");
});

test("leaves weak generic jobs unknown", () => {
  const result = classify(
    "Software Engineer",
    "Join a team building excellent products and collaborating with cross-functional partners."
  );

  assert.equal(result.decision, "Unknown");
});

function makeStubElement(tagName, text, role = null, id = "") {
  return {
    tagName,
    innerText: text,
    textContent: text,
    value: "",
    name: "",
    id,
    labels: [],
    closest: () => null,
    getAttribute: (attr) => {
      if (attr === "role") return role;
      if (attr === "id") return id;
      return null;
    }
  };
}

test("does not treat a review card's 'Edit' button as an answer control", () => {
  const editButton = makeStubElement("BUTTON", "Edit");
  const submitButton = makeStubElement("BUTTON", "Submit");
  const yesRadioLabel = makeStubElement("LABEL", "Yes");
  const customDropdownButton = makeStubElement("BUTTON", "Select an option", "button");

  assert.equal(isAnswerControlElement(editButton), false);
  assert.equal(isAnswerControlElement(submitButton), false);
  assert.equal(isAnswerControlElement(yesRadioLabel), true);
  assert.equal(isAnswerControlElement(customDropdownButton), true);
});

test("does not treat a 'Download Resume' button as an answer control", () => {
  const downloadResumeButton = makeStubElement("BUTTON", "Download Resume");
  const viewResumeButton = makeStubElement("BUTTON", "View Resume");
  const printButton = makeStubElement("BUTTON", "Print");

  assert.equal(isAnswerControlElement(downloadResumeButton), false);
  assert.equal(isAnswerControlElement(viewResumeButton), false);
  assert.equal(isAnswerControlElement(printButton), false);
});

test("excludes Apple's saved-file download buttons by id, even when the label is just the filename", () => {
  // Apple's Review & Submit page labels these buttons with the uploaded filename itself
  // (e.g. "Yifu_Zhou_Resume.pdf"), which the text denylist can't reliably catch, so the id
  // ("...downloadfile...") is what has to exclude them.
  const resumeDownloadButton = makeStubElement("BUTTON", "Yifu_Zhou_Resume.pdf", null, "apply-resume-downloadfile");
  const coverLetterDownloadButton = makeStubElement(
    "BUTTON",
    "Cover_letter.pdf",
    null,
    "apply-links-downloadfile-9d607e9f-5da0-40ec-9451-594ffa6eaf47"
  );

  assert.equal(isNonAnswerAction(resumeDownloadButton), true);
  assert.equal(isAnswerControlElement(resumeDownloadButton), false);
  assert.equal(isNonAnswerAction(coverLetterDownloadButton), true);
  assert.equal(isAnswerControlElement(coverLetterDownloadButton), false);
});

test("excludes every section's Edit button by its '-edit-button' id suffix", () => {
  const sectionIds = [
    "apply-contact-edit-button",
    "apply-resume-edit-button",
    "apply-educationDegrees-edit-button",
    "apply-employments-edit-button",
    "apply-skills-edit-button",
    "apply-languages-edit-button",
    "apply-links-edit-button",
    "apply-selfdisclosure-edit-button",
    "apply-questionnaire-edit-button"
  ];

  for (const id of sectionIds) {
    const editButton = makeStubElement("BUTTON", "Edit", null, id);
    assert.equal(isAnswerControlElement(editButton), false, id);
  }
});

test("recognizes genuine open-ended essay questions", () => {
  assert.equal(isEssayQuestionLabel("Why do you want to work at this company?"), true);
  assert.equal(isEssayQuestionLabel("Tell us about a challenge you overcame."), true);
  assert.equal(isEssayQuestionLabel("What interests you about this role?"), true);
  assert.equal(isEssayQuestionLabel("Describe a time you showed leadership."), true);
});

test("does not treat personal-info fields as essay questions, even when they contain '?' or 'company'", () => {
  // "What company do you currently work for?" contains both a "?" and the word "company", which
  // would otherwise collide with the essay allowlist -- the personal-info denylist must win.
  assert.equal(isEssayQuestionLabel("What company do you currently work for?"), false);
  assert.equal(isEssayQuestionLabel("What is your current employer?"), false);
  assert.equal(isEssayQuestionLabel("LinkedIn URL"), false);
  assert.equal(isEssayQuestionLabel("What is your expected salary?"), false);
  assert.equal(isEssayQuestionLabel("Full Name"), false);
  assert.equal(isEssayQuestionLabel("Email address"), false);
});

test("does not treat plain unlabeled or unrelated text as an essay question", () => {
  assert.equal(isEssayQuestionLabel("Phone number"), false);
  assert.equal(isEssayQuestionLabel(""), false);
});
