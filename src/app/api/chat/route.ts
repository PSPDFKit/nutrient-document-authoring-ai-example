import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, generateText, Output, stepCountIs, streamText, type UIMessage } from 'ai';
import { getAiPromptGuide, getAiToolDefinitions } from '@nutrient-sdk/document-authoring-ai';
import { toVercelAiTools, toVercelAiWorkflowOutputSchema } from '@nutrient-sdk/document-authoring-ai/vercel';
import { getAiUseCaseWorkflow, normalizeAiUseCaseId, normalizeTranslationTargetLanguage } from '../../../lib/ai-use-cases';

export const maxDuration = 300;

const getModelSettings = () => {
	const modelId = process.env.DOCUMENT_AUTHORING_AI_EXAMPLE_OPENAI_MODEL ?? 'gpt-5.4-mini';
	// Reasoning models reject sampling parameters; everything else gets a low
	// temperature for stable edits.
	const isReasoningModel = /^(?:gpt-5|o\d)/.test(modelId);
	return { model: openai(modelId), ...(isReasoningModel ? {} : { temperature: 0.1 }) };
};

type RequestBody = {
	messages?: unknown;
	workflowInput?: unknown;
	useCase?: unknown;
	translationTargetLanguage?: unknown;
	task?: unknown;
	reviewComments?: unknown;
};

export async function POST(req: Request) {
	if (!process.env.OPENAI_API_KEY) {
		return Response.json({ error: 'OPENAI_API_KEY is not configured.' }, { status: 500 });
	}

	const body: RequestBody = await req.json().catch(() => ({}));
	const useCaseId = normalizeAiUseCaseId(body?.useCase);

	if (body !== null && typeof body === 'object' && 'workflowInput' in body) {
		const workflow = getAiUseCaseWorkflow(useCaseId, {
			translationTargetLanguage: normalizeTranslationTargetLanguage(body.translationTargetLanguage),
		});
		const input = (body.workflowInput ?? {}) as { scope?: unknown; inputText?: unknown; inputFragment?: unknown };
		const result = await generateText({
			...getModelSettings(),
			system: `${workflow.systemPrompt}

Return only a JSON object with this shape:
{
  "replacementFragment": { ...complete replacement DocJSON fragment... }
}

The replacementFragment must preserve the input fragment type, version, resources, stylesTable, and listFormatTable.`,
			prompt: JSON.stringify({
				task: typeof body.task === 'string' && body.task.trim().length > 0 ? body.task : workflow.defaultTask,
				input: {
					scope: input.scope === 'document' ? 'document' : 'selection',
					text: input.inputText,
					fragment: input.inputFragment,
				},
			}),
			output: Output.object(toVercelAiWorkflowOutputSchema(workflow)),
			providerOptions: {
				openai: {
					strictJsonSchema: false,
				},
			},
		});

		return Response.json({ output: result.output });
	}

	if (!Array.isArray(body?.messages)) {
		return Response.json({ error: 'Invalid chat request.' }, { status: 400 });
	}
	if (useCaseId !== 'ai-editor') {
		return Response.json({ error: 'Workflow use cases require a workflow request.' }, { status: 400 });
	}

	const reviewComments = body.reviewComments === 'create' ? 'create' : 'disabled';
	const result = streamText({
		...getModelSettings(),
		system: `${getAiPromptGuide()}

${reviewComments === 'create' ? 'Review comments are enabled. Include a concise reviewComment on every write tool call.' : 'Review comments are disabled. Do not include reviewComment on any tool call.'}
When an edit is unsupported by the available tools, say so clearly instead of inventing a workaround.
Keep user-facing replies concise.`,
		messages: await convertToModelMessages(body.messages as UIMessage[]),
		stopWhen: stepCountIs(20),
		tools: toVercelAiTools(getAiToolDefinitions({ reviewComments })),
	});

	return result.toUIMessageStreamResponse();
}
