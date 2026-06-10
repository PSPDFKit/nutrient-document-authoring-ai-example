import { createWorkflow, getBuiltInWorkflow, type TranslationLanguage, type Workflow } from '@nutrient-sdk/document-authoring-ai';

export const AI_USE_CASE_IDS = ['ai-editor', 'proofreading', 'translation', 'template-fields'] as const;

export type AiUseCaseId = (typeof AI_USE_CASE_IDS)[number];

export const DEFAULT_AI_USE_CASE_ID: AiUseCaseId = 'ai-editor';
export const DEFAULT_TRANSLATION_TARGET_LANGUAGE: TranslationLanguage = 'spanish';

export const TRANSLATION_TARGET_LANGUAGES: readonly { id: TranslationLanguage; label: string }[] = [
	{ id: 'english', label: 'English' },
	{ id: 'german', label: 'German' },
	{ id: 'french', label: 'French' },
	{ id: 'spanish', label: 'Spanish' },
];

export const TEMPLATE_FIELD_CATALOG: readonly {
	id: string;
	label: string;
	fields: readonly { path: string; label: string; description: string }[];
}[] = [
	{
		id: 'client',
		label: 'Client',
		fields: [
			{ path: 'client.name', label: 'Client name', description: 'The legal name of the party receiving services.' },
			{ path: 'client.contactName', label: 'Client contact name', description: 'The person who receives notices or signing instructions.' },
			{ path: 'client.address', label: 'Client address', description: 'The client mailing address used in the contract preamble.' },
		],
	},
	{
		id: 'consultant',
		label: 'Consultant',
		fields: [
			{ path: 'consultant.name', label: 'Consultant name', description: 'The legal name of the party providing services.' },
			{ path: 'consultant.email', label: 'Consultant email', description: 'The consultant email address for contract notices.' },
		],
	},
	{
		id: 'agreement',
		label: 'Agreement',
		fields: [
			{ path: 'agreement.effectiveDate', label: 'Effective date', description: 'The date when the agreement starts.' },
			{ path: 'agreement.fee', label: 'Fee', description: 'The total fixed amount payable under the agreement.' },
			{ path: 'agreement.termMonths', label: 'Term length', description: 'The duration of the agreement expressed as a month count or phrase.' },
		],
	},
	{
		id: 'owner',
		label: 'Owner',
		fields: [
			{ path: 'owner.fullName', label: 'Owner full name', description: 'The internal owner or sender shown near the signature block.' },
			{ path: 'owner.title', label: 'Owner title', description: 'The job title of the internal owner or sender.' },
		],
	},
];

const SELECTION_WORKFLOW = createWorkflow({
	name: 'selection_custom',
	systemPrompt: `You are running a selected-content editing workflow.

Return structured workflow output with a replacementFragment DocJSON object.

Selection scope:
- Apply the user's task only to the selected DocJSON fragment.
- Preserve useful structure, links, lists, tables, and formatting from the selected DocJSON fragment.
- Return a complete DocJSON fragment that can replace the selection.
- Preserve the existing fragment type tag, version, resources, styles, and list formats unless the edit requires a change.
- If the task needs content outside the selection, return replacementFragment equal to the selected fragment.`,
	defaultTask: 'Apply the user request to the selected DocJSON fragment.',
});

const TEMPLATE_FIELDS_WORKFLOW = createWorkflow({
	name: 'template_fields',
	systemPrompt: `You are running the Template Builder workflow.

Return structured workflow output with a replacementFragment DocJSON object.

Template field scope:
- Convert static contract values into reusable placeholders from the allowed field catalog.
- Use placeholders exactly in the form {{field.path}}.
- Only use field paths from the allowed field catalog below.
- The input includes a scope field, but this workflow expects scope "document" and returns a complete replacement DocJSON fragment for the whole document body.
- Preserve document structure, paragraph order, legal wording, punctuation, links, lists, tables, line breaks, and useful formatting.
- Infer field values from the whole document before replacing values.
- For every allowed field, inspect the full document for likely values, including values that appear only once.
- Replace every occurrence of each inferred field value across the document.
- Do not leave an inferred field value hardcoded in replacementFragment.
- Do not invent field paths, add clauses, remove clauses, summarize, or rewrite for style.
- If no static values match the allowed field catalog, return replacementFragment equal to the input fragment.

Allowed field catalog:
${TEMPLATE_FIELD_CATALOG.map(
	(group) => `- ${group.label}: ${group.fields.map((field) => `${field.label} (${field.description}) => {{${field.path}}}`).join('; ')}`,
).join('\n')}`,
	defaultTask:
		'Infer all static contract values that match the allowed field catalog, then replace every occurrence of each inferred value with reusable {{field.path}} placeholders.',
});

export const normalizeAiUseCaseId = (value: unknown): AiUseCaseId =>
	AI_USE_CASE_IDS.includes(value as AiUseCaseId) ? (value as AiUseCaseId) : DEFAULT_AI_USE_CASE_ID;

export const normalizeTranslationTargetLanguage = (value: unknown): TranslationLanguage =>
	TRANSLATION_TARGET_LANGUAGES.some(({ id }) => id === value) ? (value as TranslationLanguage) : DEFAULT_TRANSLATION_TARGET_LANGUAGE;

export const getAiUseCaseWorkflow = (
	useCaseId: AiUseCaseId,
	options: { translationTargetLanguage?: TranslationLanguage } = {},
): Workflow<string> => {
	switch (useCaseId) {
		case 'ai-editor':
			return SELECTION_WORKFLOW;
		case 'proofreading':
			return getBuiltInWorkflow('proofreading');
		case 'translation':
			return getBuiltInWorkflow('translation', {
				targetLanguage: options.translationTargetLanguage ?? DEFAULT_TRANSLATION_TARGET_LANGUAGE,
			});
		case 'template-fields':
			return TEMPLATE_FIELDS_WORKFLOW;
	}
};

export type { TranslationLanguage };
