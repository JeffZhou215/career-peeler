const assert = require("node:assert/strict");
const path = require("node:path");

const core = require(path.join(__dirname, "..", "lib", "core.js"));
const {
  getSiteConfig,
  getJobIdFromUrl,
  compactJobRecord,
  compactError,
  getYoeHardSkip,
  applyRequiredYoeHardSkip,
  normalizeUserProfile,
  buildLlmPrompt,
  buildAnswerPrompt,
  callOpenAi,
  getLlmMatch,
  applyLlmMatch,
  generateFreeTextAnswer,
  hasLlmAnswerCapability
} = core;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const asyncTests = [];

function asyncTest(name, fn) {
  asyncTests.push({ name, fn });
}

test("lib/core.js is a real CommonJS module usable via plain require()", () => {
  assert.equal(typeof getSiteConfig, "function");
  assert.equal(typeof core.SITE_CONFIGS, "object");
});

test("getSiteConfig and getJobIdFromUrl work identically to the VM-harness-tested copies", () => {
  assert.equal(getSiteConfig("https://jobs.apple.com/en-us/search")?.id, "apple");
  assert.equal(getSiteConfig("https://joinbytedance.com/search?keyword=engineer")?.id, "tiktok");
  assert.equal(getSiteConfig("https://example.com"), null);
  assert.equal(
    getJobIdFromUrl("https://jobs.apple.com/en-us/details/200669112-0836/software-engineer"),
    "200669112-0836"
  );
});

test("compactJobRecord and compactError shape values defensively", () => {
  const record = compactJobRecord(
    { jobId: "123", url: "https://jobs.apple.com/en-us/details/123", title: "Engineer", decision: "Review" },
    "reviewed"
  );
  assert.equal(record.jobId, "123");
  assert.equal(record.site, "apple");
  assert.equal(record.status, "reviewed");

  const error = compactError({
    type: "apply_failed",
    jobId: "123",
    url: "https://jobs.apple.com/en-us/details/123",
    status: "error",
    message: "x".repeat(400)
  });
  assert.equal(error.errorType, "apply_failed");
  assert.equal(error.message.endsWith("..."), true);
  assert.equal(error.manualReviewUrl, "https://jobs.apple.com/en-us/details/123");
});

test("getYoeHardSkip and applyRequiredYoeHardSkip take userProfile as an explicit parameter", () => {
  const profile = normalizeUserProfile({ userYearsOfExperience: 2 });
  const job = { decision: "Likely match", requiredYears: 8, matches: [] };

  const hardSkip = getYoeHardSkip(job, profile);
  assert.equal(hardSkip.requiredYears, 8);

  const guarded = applyRequiredYoeHardSkip(job, profile);
  assert.equal(guarded.decision, "Likely skip");
});

test("buildLlmPrompt and buildAnswerPrompt produce well-shaped chat messages", () => {
  const profile = normalizeUserProfile({ resumeProfile: "5 years backend.", userYearsOfExperience: 5 });
  const job = { title: "Backend Engineer", url: "https://jobs.apple.com/x", matches: [], matchScore: { keywords: [] } };

  const matchMessages = buildLlmPrompt(job, profile);
  assert.equal(matchMessages.length, 2);
  assert.equal(matchMessages[0].role, "system");
  const matchUserContent = JSON.parse(matchMessages[1].content);
  assert.equal(matchUserContent.resume_profile, "5 years backend.");

  const answerMessages = buildAnswerPrompt("Why this company?", job, profile);
  assert.equal(answerMessages.length, 2);
  const answerUserContent = JSON.parse(answerMessages[1].content);
  assert.equal(answerUserContent.question, "Why this company?");
});

async function withStubbedFetch(responder, fn) {
  const originalFetch = global.fetch;
  global.fetch = responder;
  try {
    await fn();
  } finally {
    global.fetch = originalFetch;
  }
}

function jsonFetchResponse(payload) {
  return async () => ({
    ok: true,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(payload) } }] })
  });
}

asyncTest("callOpenAi parses the chat completion content out of a stubbed response", async () => {
  await withStubbedFetch(jsonFetchResponse({ hello: "world" }), async () => {
    const content = await callOpenAi([{ role: "user", content: "hi" }], { apiKey: "sk-test", model: "gpt-4o-mini" });
    assert.equal(JSON.parse(content).hello, "world");
  });
});

asyncTest("getLlmMatch returns null without calling fetch when LLM matching is not enabled", async () => {
  let fetchCalled = false;
  await withStubbedFetch(
    async () => {
      fetchCalled = true;
      throw new Error("fetch should not have been called");
    },
    async () => {
      const profile = normalizeUserProfile({ llmEnabled: false });
      const result = await getLlmMatch({ decision: "Review", matches: [] }, profile);
      assert.equal(result, null);
    }
  );
  assert.equal(fetchCalled, false);
});

asyncTest("getLlmMatch(job, userProfile) forwards the explicit userProfile param through to the prompt/decision", async () => {
  await withStubbedFetch(
    jsonFetchResponse({ decision: "Likely match", confidence: 80, yoe_assessment: "acceptable", reason: "Good fit." }),
    async () => {
      const profile = normalizeUserProfile({
        llmEnabled: true,
        llmApiKey: "sk-test",
        resumeProfile: "Backend engineer, 5 years."
      });
      const result = await getLlmMatch({ decision: "Review", matches: [] }, profile);
      assert.equal(result.decision, "Likely match");
      assert.equal(result.confidence, 80);
    }
  );
});

asyncTest("applyLlmMatch(job, userProfile, {onError}) reports failures via the callback instead of a shared rememberError", async () => {
  const errors = [];
  await withStubbedFetch(
    async () => {
      throw new Error("network down");
    },
    async () => {
      const profile = normalizeUserProfile({
        llmEnabled: true,
        llmApiKey: "sk-test",
        resumeProfile: "Backend engineer."
      });
      const job = { jobId: "1", title: "Engineer", url: "https://x", decision: "Review", matches: [] };
      const result = await applyLlmMatch(job, profile, { onError: (error) => errors.push(error) });

      assert.equal(result.matchSource, "local");
      assert.match(result.llmError, /network down/);
      assert.equal(errors.length, 1);
      assert.equal(errors[0].type, "llm_match_failed");
    }
  );
});

asyncTest("generateFreeTextAnswer({questionText, job, userProfile}) resolves job as a plain parameter, not a storage lookup", async () => {
  await withStubbedFetch(jsonFetchResponse({ answer: "I'm excited about this role because of X." }), async () => {
    const profile = normalizeUserProfile({
      llmEnabled: true,
      llmApiKey: "sk-test",
      resumeProfile: "Backend engineer."
    });
    const job = { title: "Engineer", siteLabel: "Apple Careers", matchScore: { keywords: ["Swift"] } };
    const response = await generateFreeTextAnswer({ questionText: "Why this company?", job, userProfile: profile });

    assert.equal(response.ok, true);
    assert.match(response.data.answer, /excited/);
  });
});

asyncTest("generateFreeTextAnswer short-circuits to ok:false without calling fetch when LLM answer capability is missing", async () => {
  let fetchCalled = false;
  await withStubbedFetch(
    async () => {
      fetchCalled = true;
      throw new Error("fetch should not have been called");
    },
    async () => {
      assert.equal(hasLlmAnswerCapability(normalizeUserProfile({})), false);
      const response = await generateFreeTextAnswer({
        questionText: "Why this company?",
        job: null,
        userProfile: normalizeUserProfile({})
      });
      assert.equal(response.ok, false);
    }
  );
  assert.equal(fetchCalled, false);
});

(async () => {
  for (const { name, fn } of asyncTests) {
    try {
      await fn();
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
