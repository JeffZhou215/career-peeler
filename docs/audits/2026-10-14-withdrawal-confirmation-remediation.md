# Withdrawal Confirmation Remediation — F01

## Scope and Reproduction

Baseline: `a3c2dd9`. This remediation addresses only F01 from [the reliability audit](2026-10-14-reliability-audit.md). No real Apple submissions, withdrawals, or OpenAI requests were used.

The original isolated `withdrawal-modal-probe.cjs` ran the actual background locator against a synthetic Chrome/DOM boundary. After opening job A, the fixture replaced its generic confirmation with job B's modal on the same page. The requested ID remained `200000001`, but the logged Proceed target was `200000002`; permission was accepted. The replacement passed geometry and hit testing because those checks validated the replacement button, not its ownership.

## Root Cause and Interaction Trace

The panel selected cached role IDs and coordinated pagination. `withdrawAppleSubmittedRoles()` found the selected card, opened Withdraw, waited for a generic modal, and requested Proceed. `dispatchTrustedAppleWithdrawalClick()` remembered only a job ID and start time. Its subsequent injected locator selected any visible modal with Apple's generic heading and Proceed button. The modal itself contains no verified job ID. A page ordinal and remembered ID could not establish that this modal still belonged to the original operation. Chrome's asynchronous mouse commands introduced another replacement window after coordinates were returned.

The repaired path is:

1. `reviewWithdrawals()` freezes the exact full job IDs/titles shown in the confirmation sheet. `withdrawSelected()` consumes this explicit review once.
2. `setAppleWithdrawalBatch()` binds the confirmed IDs to one tab, takes an exclusive lease, and rejects concurrent starts. The first action binds the batch to Chrome's exact `documentId`.
3. Each role has a unique request ID. `withdrawAppleSubmittedRoles()` stores a page-local operation before awaiting anything. Duplicate deliveries return its existing result/promise rather than repeat input.
4. `CareerPeelerAppleWithdrawalSafety.create()` binds the original live card, detail anchor, star checkbox, Withdraw control, page and URL. It observes mutations before Open and captures the first resulting modal and original Proceed control. Ordered mutation records detect remove/reinsert and A→B changes within one browser task.
5. `prepare()` consumes each action once and waits for enabled, unobscured, stable geometry after debugger attachment. It keeps the original references rather than selecting another current popup.
6. A gate installed at `document_start` rechecks full job identity, star status, page, original modal/header/content and hit target during trusted pointer/mouse/click events, before Apple handlers. Any ambiguity, replacement, stale node, intervening interaction or expired authority stops the operation. A late fallback installation cannot authorize a withdrawal; the user must reload the Apple page.
7. The worker verifies selection ownership between CDP commands. Temporary `Page.addScriptToEvaluateOnNewDocument` input blocking protects a newly navigated document from queued old coordinates. Prepare/finish messages target the original `documentId`. Batch release revokes the exact page-local operation.
8. `finish()` acknowledges only the bound control's observed activation. Activation is **not** withdrawal success. The content workflow requires a fresh Apple success-alert content update and settled inventory before reporting confirmation. An unchanged preexisting notification, including one restyled or reinserted, cannot supply success proof. Merely disappearing from the current page is insufficient.
9. `getAppleWithdrawalStatus()` can reconcile a lost response only against the exact operation's recorded confirmation. Missing documents, failed actions and unknown results cannot become successes from inventory absence alone. Confirmed roles are persisted individually before the next withdrawal; later errors retain prior confirmations and stop the batch.

## Relevant Files

- `lib/appleWithdrawalSafety.js`: early input gate, live identity and modal continuity checks, one-use actions, mutation history and fresh success evidence.
- `background.js`: `setAppleWithdrawalBatch()`, `dispatchTrustedAppleWithdrawalClick()` and per-command ownership checks.
- `content.js`: `findSubmittedRoleCard()`, operation registry, withdrawal execution and bound status reconciliation.
- `src/sidepanel/components/SubmittedApplicationsSection.jsx`: frozen review, direct mutation messages, sequential persistence.
- `src/sidepanel/lib/submittedWithdrawals.mjs`: strict identity acknowledgments and conservative lost-response handling.
- `manifest.json`, fallback injection paths and `package.json`: load/check the focused classic helper.

## Regression Coverage

The tests use a persistent synthetic DOM with capture/bubbling event ordering, queued mutation records, property changes that do not emit mutations, and controlled timer tasks. They exercise real helper logic, real worker/content message paths, review selection logic and per-role persistence. The obsolete fresh-VM-per-click locator test was replaced by these persistent-context tests; its layout, disabled-control and hit-test coverage was preserved.

Covered sequences include replacement modals, same-node remove/reinsert and hide/reopen, header/body rerenders, stale cards/buttons, changed full job suffix, unknown/changed starred status, page/context changes, delayed controls, obscured clicks, repeated/concurrent requests, cancellation, worker restart, native document replacement, stale success alerts, lost replies, and partial batch or cache-write failures.

| Verification | Result |
| --- | --- |
| Full `npm test`, final run | 542 passed, 0 failed, 0 skipped/cancelled |
| Full `npm test`, repeated run | 542 passed, 0 failed, 0 skipped/cancelled |
| `npm run check` | Runtime syntax checks and Vite production build passed |
| `git diff --check` | Passed |
| Live Apple actions | None |

The baseline suite had 471 tests. One obsolete locator test was replaced by persistent-context coverage; the final suite has a net gain of 71 tests. The fixture includes separate timer tasks and real-style child-list text replacement, so the tests do not rely on a new DOM/VM per click or on MutationObserver always running before a mouse event.

## Trade-offs and Remaining Integration Work

- Safe continuity is deliberately conservative. Replacing an otherwise legitimate card, popup, header or Proceed element stops the batch instead of guessing that the replacement has the same subject. Initial popup construction and ordinary enabling/layout delays remain supported.
- Existing Apple tabs need a reload after updating the extension to install the early gate. An idle-time fallback does not grant equivalent safety.
- Apple's currently observed modal exposes no independently verifiable role ID. Binding relies on an uninterrupted, observed Open from the exact selected card. A hidden Apple internal-state or server bug that changes the modal's subject without any observable DOM/context/interaction change cannot be independently proven away by DOM automation.
- If Apple emits an identical notification to an existing success message (for example, two different job IDs sharing a title), the extension conservatively reports unknown unless fresh, distinguishable confirmation is observed. The batch stops for reconciliation rather than guessing.
- Native Chrome integration must validate the document-start capture ordering across isolated worlds, CDP mouse-event delivery, debugger viewport changes, full-document navigation blocking/cleanup, and Apple's live modal/alert rendering. Synthetic fixtures do not prove these browser/website details.
- The temporary new-document blocker operates in the page's main world. It is protection against ordinary navigation/rerender races, not a security boundary against malicious Apple page JavaScript. Input redirected into a pre-existing iframe also requires native-frame integration validation; the verified withdrawal flow currently assumes Apple's top-level roles/modal UI.
- On a worker crash or debugger cleanup failure during navigation, temporary input blocking may remain in the new document. Reloading restores ordinary page interaction; withdrawal authority is never automatically restored.
- No unrelated audit finding, application behavior, capacity reservation policy, or non-Apple support was changed. In particular, F10's separate reservation-accounting remediation remains outstanding.
