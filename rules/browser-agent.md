# Browser automation internals

## The generic-autofill pipeline is snapshot -> classify/resolve -> act, not an unrestricted LLM tool loop

Known fields are classified deterministically. An unresolved application question may use the shared
background question agent, but that agent can return only `answer_text`, `choose_option`, or `skip`;
it never receives a DOM handle/selector and never executes a browser action. Concretely:

- `snapshot.js`'s `snapshotPage()` returns a flat list of `field` / `question` / `dropdown` / `file`
  entries. `loop.js` re-runs it between sequential actions so later actions do not rely on stale DOM
  references. The full snapshot is never handed to an LLM.
- `classify.js` is pure label -> concept classification (`inferGenericFieldMapping`,
  `findAllQuestionContainers`, `buildOptionMatcher`, etc.) - no DOM mutation, only `querySelector`-style
  reads. Keep it that way so it stays directly unit-testable via the VM harness (see
  `implementation.md`).
- `actions.js` owns every real DOM mutation/click request (`fillTextField`, `selectMatchingOption`,
  `simulateRealClick`, `clickOptionMatchingText`, `openDropdownAndSelectOption`, `waitForSettle`, ...).
  `mainWorldBridge.js` is its narrow execution endpoint for Workday text commits and already-resolved
  dropdown clicks that must enter the page's JavaScript world; it must not discover fields, read
  profile data, choose answers, verify results, or navigate.
- `workdayExperience.js` is the narrow repeated-record adapter for Workday's My Experience page. It
  sequences the existing action primitives across one freshly-read Work Experience/Education row at
  a time, verifies required values before retaining the row, and returns observed structured entries
  for background-owned CandidateProfile persistence; it is not a second generic filler.
- `loop.js` orchestrates these layers, one field/question/dropdown entry at a time. For unresolved
  questions it sends only question text, offered option text, page/job context, and profile context to
  `APPLE_CAREERS_RESOLVE_APPLICATION_QUESTION`; it then executes and verifies the returned bounded
  decision locally.

The LLM has three narrow responsibilities in `lib/core.js`: `getLlmMatch` (job/resume fit), resume-
grounded free text, and `resolveApplicationQuestion` (one bounded answer/option decision). Unknown
questions enter the agent only as open text or dropdowns; unknown radio/button groups remain flagged.
The sole option-group exception is a recognizable previous-employer question: it resolves locally
from `candidateProfile.experience`, selects Yes only for a normalized employer match and No only when
the populated profile has no match, and stops rather than guessing when employer history is unavailable.
Open-text resolution may expose OpenAI's hosted `web_search` tool inside one bounded Responses request
for public company/startup/product context, but candidate claims remain resume/profile-only. Dropdown
resolution cannot search and can select only an exact observed option. Fixed work-auth/sponsorship/
criminal-history/date policies resolve locally before any model call. Required EEO controls use the
user's saved local Required Application Answers and may return the internal `choose_options` action
for an explicit multi-select/checkbox group; optional or voluntary EEO controls are skipped. Sensitive
EEO values are never included in an LLM prompt or activity observation.
**Never let the LLM choose a DOM element, selector, arbitrary click, navigation, or submit action.** A
future change that gives it broader browser tools is a materially different design and requires
explicit discussion.

## Field/question mapping shapes (`classify.js`'s `inferGenericFieldMapping`)

Four action types, matched in this order (most specific first, essay last):

- `{action:"map", profileKey}` - value comes from the user's saved profile.
- `{action:"fixed", value}` - one policy answer independent of the profile (e.g. referral source is
  Other when that exact option is offered). Use this, not a new ad-hoc branch, for future
  fixed-answer concepts.
- `{action:"candidate_employment"}` - previous-employer Yes/No resolved from the named employer and
  `candidateProfile.experience`; no fixed default and no inferred candidate history.
- `{action:"essay"}` - free-text, routed to the bounded question agent in `prompt.js`, grounded in the
  extracted candidate profile / resume summary. A verified answer can continue full-auto; no answer or
  a failed verification leaves the field flagged and blocks submission - never a popup.

`QUESTION_RULES` in `loop.js` mirrors this for radio/button-group entries: a `matcher` function plus
either a `profileKey` (profile lookup) or a `fixedValue` (same "always X" concept). Previous-employer
option groups run in a separate bounded pre-pass before ordinary Workday fields because answering a
radio can re-render the form; an already-selected answer is verified and never clicked again.

## Never guess at an unconfirmed widget interaction

Custom dropdown widgets (`role=combobox`/`listbox`) may be opened to read their real visible options.
The resolver may select only one of those observed options (internally represented by stable option
IDs); the local action layer clicks it and verifies selected state/displayed value. Never type an
invented value into a closed dropdown or treat the menu's mere option text as confirmation.

Same logic for every click-based fill: **verify the click actually took effect**
(`isOptionConfirmedSelected`) rather than assuming a `.click()` succeeded. This caught real
"answered" questions on a live application that were still failing the site's own required-field
validation afterward. Use `waitForSettle()` (`MutationObserver` + polling quiet-period) to confirm a
click actually changed the page before deciding what happened next - don't substitute a fixed
`setTimeout` delay.

Workday's single-select buttons expose their saved state directly through a non-empty `value`, visible
button text, and `aria-expanded`; when the existing text matches the deterministic answer, leave the
value untouched instead of reopening the menu. If a Workday menu remains expanded, send dismissal to
the listbox named by the trigger's `aria-controls` before falling back to one trigger toggle. Do not
infer open/closed state from option-node visibility because Workday can retain stale option nodes.

Workday text inputs and month/year spinbuttons are controlled FormKit fields: a synthetic DOM value can
be visible while Workday's internal answer remains empty. Values written by Career Peeler therefore use
a staged native-setter sequence (clear, prefix, final character) with bubbling/composed `input` events
inside the page's MAIN JavaScript world, then blur to commit and verify a fresh field read. This
intentionally reproduces the manual last-character edit without routing ordinary form text through CDP;
the isolated pipeline sends only the resolved value and a temporary field marker to the page-world bridge.
Date verification must also agree with Workday's `aria-valuenow`, display, or current-value state; raw
`.value` alone is not proof that a Workday date was accepted. A visible non-empty value that Workday
explicitly marks invalid after Continue may receive one stronger trusted repair: the isolated script
focuses and fully selects that exact field, then the Workday-only background endpoint sends one fixed
Backspace and one bounded `Input.insertText`. The field is freshly re-read and must retain the exact
value with its explicit error cleared. This repair is attempted once, never used proactively for every
text field, and never becomes an unbounded retry loop.

Workday `multiSelectContainer` widgets are dropdowns even when their editable search input has no
combobox role. Search/filter text is never a selected value: verification requires a matching
`data-automation-id="selectedItem"` chip. Selected-item chips are excluded from the visible option menu
inventory so a previously chosen phone code cannot masquerade as a newly offered application answer.
Responsive Workday prompts with a hidden search box must be opened through their `promptSearchButton`,
and their live `promptOption` nodes count as offered choices even though Workday gives them no option
role. Workday referral-source prompts run in a bounded pre-pass before ordinary text fields because
committing the source can re-render sibling controls. After opening, re-read the prompt instead of
reusing its pre-open container: Workday can replace that node while rendering the menu. Inspect the
rendered root first. If neither exact `Other` nor a LinkedIn option is present, open only an observed
`External Career Site Sources` or `Job Board` category, then keep observing across intermediate option
batches until a preferred child appears or the bounded timeout expires. Prefer an
exact `Other` at every observed level. When no exact `Other` is offered, choose exact `LinkedIn` when
offered; otherwise choose the shortest observed option containing `LinkedIn` (for example `LinkedIn
Connection Post`). Never type or clear text in the source prompt's search input. Prefer the
rendered `role=option`/`menuItem` target; if Workday exposes only a `promptOption` wrapper, the
already-resolved option may use the short-lived trusted mouse endpoint. The background derives the tab
from the message sender, accepts no selector or arbitrary CDP method, restricts the endpoint to Workday
hosts, and detaches immediately. If a LinkedIn-labelled match opens another category, follow only newly
rendered LinkedIn-containing children, with a four-level cap; never click an unrelated option to probe
the tree. For responsive prompt menus, treat `data-uxi-multiselectlistitem-type="2"` rows as branches
and `type="1"` rows as selectable leaves. Reuse an already-open prompt associated with the source
widget instead of clicking its opener again. For both branch and leaf rows, first use the captured
page-context `focus` → `mousedown` → `mouseup` → `click` → `blur` sequence on the outer `menuItem`.
If fresh verification shows that the branch did not open or the leaf did not commit, allow one bounded
trusted-input retry at the inner rendered `promptOption` text node observed in the manual Workday trace.
The outer `menuItem` remains the inventory/type target, while the trusted retry uses the same inner text
coordinates as the real pointer event. A
dispatched sequence is not proof that a branch opened or a leaf committed: freshly inventory every
visible option and log the complete child list, or explicitly report that the root options remained
unchanged/the discovered leaf remained uncommitted. Once a preferred child becomes visible, return that
live option batch immediately; waiting for a quiet period can lose a transient Workday prompt and turn
a discovered LinkedIn leaf into an empty final snapshot.
The local pipeline must freshly re-read the field and require a matching `selectedItem` chip, stopping
for review if no preferred leaf is offered or the final chip cannot be verified. Never hard-code one
tenant's parent-category path.

## Known-site workflow (`content.js`) is a different risk tier

The three tuned sites get a multi-step "click Continue, wait, repeat" loop with retry/attempt caps
(`runApplicationWorkflow` in both `background.js` and its `cli/orchestrator.js` port). This is
deliberately **not** shared with arbitrary generic sites - chaining multi-step navigation across a
never-seen site is materially riskier than doing it on the three well-understood ones. Workday is the
one explicit generic-layer exception: only candidate-facing Workday hosts may repeat the generic sweep
across pages, and only through locally detected exact forward labels. Every other generic site still
requires the user to start a new sweep after navigation. Don't try to unify these flows.

The extension workflow is submit-first for unknown questions: fill deterministic known answers, click
an enabled Continue/Submit control, and use the site's resulting validation state to decide whether the
required-field question agent should run. A missing/disabled action is also a valid stuck signal. Do not
restore a proactive unknown-field audit immediately before every click; it is both redundant and less
reliable than the site's own validation. An ambiguous final-submit confirmation may inspect only
controls the live DOM explicitly marks as required; when that produces concrete unanswered-field
evidence, the existing bounded recovery can answer and verify those fields before one capped retry.
It must otherwise stop for review instead of broad-scanning unmarked fields or clicking Submit again.
Keep the final-Submit cap and same-field no-progress fingerprint across content-script reloads.
