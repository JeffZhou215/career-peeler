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
  parseYears,
  textIncludesTerm
} = sandbox.__contentTestApi;

function classify(title, description, userYearsOfExperience) {
  const combinedText = `${title}\n${description}`;
  const matches = extractExperienceMatches(combinedText);
  const matchScore = analyzeLocalMatch(combinedText);
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

test("skips iOS app roles with Swift/UIKit/Xcode mismatch", () => {
  const result = classify(
    "iOS Software Engineer",
    "Develop iOS applications using Swift, UIKit, SwiftUI, Objective-C, and Xcode."
  );

  assert.equal(result.decision, "Likely skip");
  assert.match(result.reason, /domain mismatch|senior-level/i);
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
    "Preferred qualifications include 5+ years of experience. Build APIs, services, queues, AWS systems, and DynamoDB-backed microservices."
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
