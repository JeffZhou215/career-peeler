# Model Selection

Setup uses a compact **Model** row and an iOS-style selection sheet. Open the sheet after validating your OpenAI API key. Choose a model from Recommended or search all compatible choices, then use Done to save. Cancel or Escape leaves the saved model unchanged. Refresh Models checks availability again.

## Compatibility Policy

`lib/openaiModelCatalog.js` is the shared compatibility catalog for the side panel and background worker. It explicitly lists supported full-size general models and documented snapshots, with GPT-4o as the baseline. Mini, nano, specialized audio/search/coding models, fine-tunes and unknown future identifiers are excluded. This is a conservative product policy based on the requested baseline, not a claim that every newer model is better on every job-matching task.

The catalog includes text/image inputs and JSON output support needed by the existing Chat Completions workflow, including PDF resume extraction. GPT-5 and GPT-6 request construction omits the unsupported temperature parameter. The configured model remains explicit; an error never triggers a switch to another model.

## Availability And Privacy

The background worker reads `GET https://api.openai.com/v1/models`, intersects the returned identifiers with the catalog, and excludes models whose announced shutdown date has passed. Only available entries are offered for selection. Recommendations are catalog preferences within that result, not a separate list of models the key cannot access.

Discovery uses your API credential in the authorization header. It does not send a PDF, profile or application answers and does not generate a paid completion. Background results are held briefly in memory per API key; they are not a new persistent source of account credentials. A key change invalidates the panel's available choices, and late responses for an old key cannot select or save a model for the new key.

The models endpoint provides basic metadata. Listing a model does not prove that a later completion will succeed under current project permissions, billing, quota or rate limits. Native account access and live completion quality are not established by offline tests. Compatibility details require maintenance as OpenAI changes models and APIs.

## Existing Settings And Scores

An existing saved model stays visible even if it is unsupported or unavailable. It is not silently replaced. Choose a supported model explicitly to resolve an unsupported old setting. Unsupported models fail before matching requests and application automation; saved personal answers remain resolved locally.

Ranking and submission score cache identities include the selected model. Changing it invalidates relevant score reuse. Existing descriptions and history remain saved, and running workflows retain the profile they started with.

## Official References

- [Models endpoint](https://developers.openai.com/api/reference/resources/models/methods/list)
- [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o) and [GPT-4.1](https://developers.openai.com/api/docs/models/gpt-4.1)
- [GPT-5.5](https://developers.openai.com/api/docs/models/gpt-5.5)
- [GPT-6 model compatibility](https://developers.openai.com/api/docs/guides/latest-model)

Catalog documentation checked October 18, 2026. Availability is checked against the user's own key when they open or refresh the picker.
