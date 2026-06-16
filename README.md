# Document Authoring AI Example

A Next.js app that connects the [Nutrient Document Authoring SDK](https://www.nutrient.io/sdk/document-authoring/) to a language model through [`@nutrient-sdk/document-authoring-ai`](https://www.npmjs.com/package/@nutrient-sdk/document-authoring-ai) and the [Vercel AI SDK](https://ai-sdk.dev).

The app has four tabs, covering the two ways to integrate Document Authoring AI.

The AI Editor tab is open-ended tool calling. The model receives document tools, decides which ones to call, and the browser executes those calls against the live editor. The assistant panel has an "Add review comments" checkbox. While it is checked, the server requires a `reviewComment` note on every write tool call, and the browser creates a document comment thread from each note. While it is unchecked, `reviewComment` is not part of the tool schema the model sees.

The Proofreading, Translation, and Template Builder tabs are structured workflows. The browser reads a workflow input snapshot from the editor, the server asks the model for a single structured workflow output object, and the browser applies that output through `toolkit.applyWorkflowOutput(...)`. Proofreading and Translation edits are applied as tracked changes when the editor is in Review mode. Template Builder loads a static contract sample beside a fixed field catalog, asks the model to replace hardcoded contract values with reusable `{{field.path}}` placeholders, and lets you apply the suggestions one at a time or all at once.

## Run

```sh
npm ci
cp .env.sample .env.local
npm run dev
```

The example installs the stable `@nutrient-sdk/document-authoring` package from npm and uses the SDK's default CDN-hosted assets.

Set `OPENAI_API_KEY` in `.env.local` before using the assistant. Optionally set `NEXT_PUBLIC_DOCUMENT_AUTHORING_LICENSE_KEY` to run Document Authoring with your SDK license instead of evaluation behavior. If you're interested in a Document Authoring license, [contact sales](https://www.nutrient.io/contact-sales/). The example defaults to `gpt-5.4-mini`.

## Sample documents

The AI Editor document is `public/sample.json`, with a DOCX version in `public/sample.docx`. It is the same document the public Document Authoring demo uses, and the app loads the JSON version by default so every session starts from the same content.

The Proofreading and Translation samples are DocJSON files in `public/proofreading-sample.json` and `public/translation-sample.json`. The Translation tab loads the English sample and translates it to English, German, French, or Spanish as tracked changes. Spanish is preselected.

The Template Builder contract is `public/template-fields-contract-sample.txt`.

## Tests

Run the basic Playwright checks without a model provider:

```sh
npm test
```

The tests start the Next.js app and verify the use-case panels, the assistant chat request wiring, and a full workflow round trip against a mocked `/api/chat` endpoint.
