---
description: Clarification and assumption policy
alwaysApply: true
---

# Clarification and Assumption Policy

- Do not make important product, architecture, workflow, or behavioral assumptions when the required information is not available from the codebase or current prompt.
- Before implementing, identify any missing information that could materially change the implementation.
- If such information cannot be resolved by inspecting the repository, ask me a concise clarifying question before editing.
- Prefer inspecting the codebase first when the answer can be determined from existing code.
- Do not ask me questions that can be answered by reading the repository.
- Do not invent requirements just to avoid asking a question.
- Do not silently choose between multiple materially different implementation options.

When uncertain, classify the uncertainty:

1. **Resolvable from code**
   - Inspect the relevant implementation and continue.

2. **Low-impact implementation detail**
   - Use the existing project convention and continue.

3. **Material product/behavior decision**
   - Ask me before implementing.

4. **Potentially destructive or architecture-changing decision**
   - Always ask me before implementing.

Examples of decisions that should usually require clarification:
- changing apply/skip policy
- changing matching thresholds
- changing which fields are automatically answered
- changing user-visible workflow behavior
- removing existing functionality
- changing data persistence/schema semantics
- introducing a new external service/provider
- deciding between substantially different architectures when the repo does not establish a convention

Before editing for a non-trivial task, briefly determine:
- what is known
- what can be verified from the codebase
- what assumptions remain
- whether any remaining assumption requires user clarification

# User Decisions vs Engineering Decisions

Ask me before deciding:
- whether the agent should apply or skip under an ambiguous policy
- whether autonomous submission behavior should change
- what answers should be hard-coded for application questions
- what information may be inferred from a resume
- whether a new user-facing workflow should replace an existing one
- threshold/default-setting changes
- destructive migrations
- significant architecture changes

Do not ask me before:
- following an existing repository pattern
- choosing an internal variable name
- fixing an obvious bug with one clear root cause
- adding tests that directly cover requested behavior
- reusing an established helper/component