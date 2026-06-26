'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import Markdown from 'react-markdown';
import {
	getAiToolDefinitions,
	isAiWriteToolName,
	parseAiToolCall,
	type AiToolName,
	type AiValidationError,
} from '@nutrient-sdk/document-authoring-ai';
import { getAiToolkit, type AiToolkit } from '@nutrient-sdk/document-authoring-ai/editor';
import {
	createDocAuthSystem,
	defaultToolbarConfig,
	type DocAuthEditor,
	type DocAuthSystem,
} from '@nutrient-sdk/document-authoring';
import {
	DEFAULT_AI_USE_CASE_ID,
	DEFAULT_TRANSLATION_TARGET_LANGUAGE,
	TEMPLATE_FIELD_CATALOG,
	TRANSLATION_TARGET_LANGUAGES,
	getAiUseCaseWorkflow,
	type AiUseCaseId,
	type TranslationLanguage,
} from '../lib/ai-use-cases';

type ReviewCommentsMode = 'disabled' | 'create';

type UseCaseUi = {
	id: AiUseCaseId;
	label: string;
	documentUrl: string;
	docxDocument?: boolean;
	plaintextDocument?: boolean;
	author: string;
	editorMode: 'edit' | 'review';
	hideToolbar?: boolean;
	panel?: {
		title: string;
		description: string;
		selectionAction: string;
		documentAction: string;
		busy: string;
		withSelectionScope: boolean;
	};
	completion: { title: string; dismissLabel: string };
};

type AssistantPromptShortcut = {
	label: string;
	prompt: string;
	forceReviewMode?: boolean;
};

const ASSISTANT_QUERY_PROMPTS: readonly AssistantPromptShortcut[] = [
	{
		label: 'Find blanks to finish',
		prompt:
			'List every bracketed blank, checkbox, and optional Cover Page item that must be completed before this Common Paper Mutual NDA is signed. Explain what decision each one needs.',
	},
	{
		label: 'Review term choices',
		prompt:
			'Review the selected MNDA Term and Term of Confidentiality. Explain whether the one-year defaults are enough for product plans, pricing, security materials, and trade secrets.',
	},
	{
		label: 'Check who can see info',
		prompt:
			'Explain who may receive Confidential Information under the Standard Terms. Flag whether affiliates, outside counsel, investors, auditors, or prospective acquirers are clearly covered.',
	},
];

const ASSISTANT_MODIFICATION_PROMPTS: readonly AssistantPromptShortcut[] = [
	{
		label: 'Fill effective date',
		prompt: 'Set the Cover Page effective date to June 25, 2026.',
		forceReviewMode: true,
	},
	{
		label: 'Set 3-year protection',
		prompt:
			'Update the Term of Confidentiality to three years from the date of last disclosure, while keeping the trade secret protection language.',
		forceReviewMode: true,
	},
	{
		label: 'Add affiliate access',
		prompt:
			'Add a Cover Page change allowing disclosure to controlled affiliates that need to know for the Purpose, if they are bound by confidentiality obligations at least as protective as this MNDA.',
		forceReviewMode: true,
	},
];

const USE_CASES: readonly UseCaseUi[] = [
	{
		id: 'ai-editor',
		label: 'Legal Assistant',
		documentUrl: '/sample.docx',
		docxDocument: true,
		author: 'AI Assistant',
		editorMode: 'edit',
		completion: { title: 'Selection updated', dismissLabel: 'Dismiss selection edit confirmation' },
	},
	{
		id: 'proofreading',
		label: 'Proofreading',
		documentUrl: '/proofreading-sample.json',
		author: 'AI Proofreader',
		editorMode: 'review',
		hideToolbar: true,
		panel: {
			title: 'Proofreading Assistant',
			description: 'Review the document or selected content and apply suggested improvements.',
			selectionAction: 'Review Selection',
			documentAction: 'Review Document',
			busy: 'Reviewing...',
			withSelectionScope: true,
		},
		completion: { title: 'Review complete', dismissLabel: 'Dismiss grammar check confirmation' },
	},
	{
		id: 'translation',
		label: 'Translation',
		documentUrl: '/translation-sample.json',
		author: 'AI Translator',
		editorMode: 'review',
		hideToolbar: true,
		panel: {
			title: 'Translation Assistant',
			description: 'Translate the document or selected content into the target language without changing the layout.',
			selectionAction: 'Translate Selection',
			documentAction: 'Translate Document',
			busy: 'Translating...',
			withSelectionScope: true,
		},
		completion: { title: 'Translation complete', dismissLabel: 'Dismiss translation confirmation' },
	},
	{
		id: 'template-fields',
		label: 'Template Builder',
		documentUrl: '/template-fields-contract-sample.txt',
		plaintextDocument: true,
		author: 'AI Assistant',
		editorMode: 'edit',
		panel: {
			title: 'Template Builder',
			description: 'Turn a completed contract into a reusable template with catalog placeholders.',
			selectionAction: 'Build Template',
			documentAction: 'Build Template',
			busy: 'Building...',
			withSelectionScope: false,
		},
		completion: { title: 'Template built', dismissLabel: 'Dismiss Template Builder confirmation' },
	},
];

// --- Document editor lifecycle ---------------------------------------------

type EditorInstance = { system: DocAuthSystem; editor: DocAuthEditor; toolkit: AiToolkit };

const loadDocumentForUseCase = async (system: DocAuthSystem, useCase: UseCaseUi) => {
	if (useCase.docxDocument) {
		return system.import(fetch(useCase.documentUrl), { fileName: useCase.documentUrl.split('/').at(-1) ?? 'document.docx' });
	}
	if (useCase.plaintextDocument) {
		const response = await fetch(useCase.documentUrl);
		if (!response.ok) {
			throw new Error(`Failed to load the ${useCase.id} sample document.`);
		}
		return system.createDocumentFromPlaintext(await response.text(), { pageSize: 'Letter' });
	}
	return system.loadDocument(fetch(useCase.documentUrl));
};

const applyUseCaseEditorSettings = (editor: DocAuthEditor, useCase: UseCaseUi) => {
	editor.setEditorMode(useCase.editorMode);
	editor.setAuthor(useCase.author);
	editor.setToolbarConfig(useCase.hideToolbar ? { items: [] } : defaultToolbarConfig);
};

/**
 * Creates the editor once, then swaps the loaded document and editor settings
 * whenever `documentKey` changes. `ready` is false while a document loads.
 */
const useDocumentEditor = (useCase: UseCaseUi, documentKey: string) => {
	const hostRef = useRef<HTMLDivElement | null>(null);
	const instanceRef = useRef<EditorInstance | null>(null);
	const initialUseCaseRef = useRef(useCase);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		let disposed = false;

		const init = async () => {
			const host = hostRef.current;
			if (!host) {
				return;
			}
			try {
				const system = await createDocAuthSystem({
					licenseKey: process.env.NEXT_PUBLIC_DOCUMENT_AUTHORING_LICENSE_KEY,
				});
				const initialUseCase = initialUseCaseRef.current;
				const editor = await system.createEditor(host, {
					document: await loadDocumentForUseCase(system, initialUseCase),
					ui: {
						toolbar: initialUseCase.hideToolbar ? { items: [] } : defaultToolbarConfig,
						author: initialUseCase.author,
					},
				});
				applyUseCaseEditorSettings(editor, initialUseCase);
				const toolkit = getAiToolkit(editor);
				if (disposed) {
					toolkit.dispose();
					editor.destroy();
					system.destroy();
					return;
				}
				instanceRef.current = { system, editor, toolkit };
				setReady(true);
			} catch (error) {
				if (!disposed && process.env.NODE_ENV !== 'production') {
					console.error('Failed to initialize Document Authoring AI example.', error);
				}
			}
		};

		void init();

		return () => {
			disposed = true;
			const instance = instanceRef.current;
			instanceRef.current = null;
			if (instance) {
				instance.toolkit.dispose();
				instance.editor.destroy();
				instance.system.destroy();
			}
		};
	}, []);

	useEffect(() => {
		const instance = instanceRef.current;
		if (!instance) {
			// Initial mount: the init effect loads the first document.
			return;
		}
		let disposed = false;
		setReady(false);

		const load = async () => {
			try {
				const document = await loadDocumentForUseCase(instance.system, useCase);
				if (disposed) {
					return;
				}
				instance.editor.setCurrentDocument(document);
				applyUseCaseEditorSettings(instance.editor, useCase);
				setReady(true);
			} catch {
				// Leave the editor unavailable; controls stay disabled.
			}
		};

		void load();

		return () => {
			disposed = true;
		};
	}, [useCase, documentKey]);

	return { hostRef, instanceRef, ready };
};

// --- Shared helpers ---------------------------------------------------------

const isAiValidationError = (error: unknown): error is AiValidationError =>
	error instanceof Error && (error as { code?: unknown }).code === 'INVALID_TOOL_CALL';

const getErrorMessage = (error: unknown) => {
	if (!(error instanceof Error)) {
		return 'Tool execution failed.';
	}
	if (isAiValidationError(error)) {
		const details = error.details;
		const cause = typeof details === 'object' && details !== null && 'cause' in details ? (details as { cause?: unknown }).cause : undefined;
		return typeof cause === 'string' && cause.length > 0 ? `${error.message} Details: ${cause}` : error.message;
	}
	return error.message;
};

const formatJson = (value: unknown) => {
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return 'Unable to display value.';
	}
};

const AssistantMarkdown = ({ text }: { text: string }) => (
	<div className="bubble-markdown">
		<Markdown
			skipHtml
			components={{
				a({ href, children }) {
					return (
						<a href={href} target="_blank" rel="noreferrer">
							{children}
						</a>
					);
				},
			}}
		>
			{text}
		</Markdown>
	</div>
);

/**
 * Automatic follow-up sends (after tool results) do not carry the submit-time
 * request body, so the chosen mode also travels as message metadata.
 */
const getReviewCommentsForRequest = (messages: readonly { role: string; metadata?: unknown }[], body?: { reviewComments?: unknown }): ReviewCommentsMode => {
	const normalize = (value: unknown): ReviewCommentsMode => (value === 'create' ? 'create' : 'disabled');
	if (body?.reviewComments !== undefined) {
		return normalize(body.reviewComments);
	}
	for (const message of messages.toReversed()) {
		const metadata = message.metadata as { reviewComments?: unknown } | undefined;
		if (message.role === 'user' && metadata?.reviewComments !== undefined) {
			return normalize(metadata.reviewComments);
		}
	}
	return 'disabled';
};

const getSelectionScopeLabel = (text: string) => {
	const compactText = text.replace(/\s+/g, ' ').trim();
	const preview = compactText.length > 80 ? `${compactText.slice(0, 77)}...` : compactText;
	return `Apply to "${preview}"`;
};

// Keep disabled attributes stable through the server/client hydration pass.
const subscribeToHydration = () => () => undefined;
const useHasHydrated = () =>
	useSyncExternalStore(
		subscribeToHydration,
		() => true,
		() => false,
	);

// --- Shell ------------------------------------------------------------------

export function DocumentAuthoringAiShell({ chrome = true }: { chrome?: boolean } = {}) {
	const [useCaseId, setUseCaseId] = useState<AiUseCaseId>(DEFAULT_AI_USE_CASE_ID);
	const [targetLanguage, setTargetLanguage] = useState<TranslationLanguage>(DEFAULT_TRANSLATION_TARGET_LANGUAGE);
	const [translationNotes, setTranslationNotes] = useState('');
	const [draftInput, setDraftInput] = useState('');
	const [panelWidth, setPanelWidth] = useState(340);
	const [workflowBusy, setWorkflowBusy] = useState(false);
	const [completionVisible, setCompletionVisible] = useState(false);
	const [workflowError, setWorkflowError] = useState<string | null>(null);
	const [selectionText, setSelectionText] = useState<string | null>(null);
	const [reviewComments, setReviewComments] = useState<ReviewCommentsMode>('disabled');
	const reviewCommentsRef = useRef<ReviewCommentsMode>('disabled');
	const layoutRef = useRef<HTMLElement | null>(null);
	const feedRef = useRef<HTMLDivElement | null>(null);
	const draggingRef = useRef(false);
	const hasHydrated = useHasHydrated();

	const useCase = USE_CASES.find((candidate) => candidate.id === useCaseId) ?? USE_CASES[0];
	const documentKey = useCaseId === 'translation' ? `translation:${targetLanguage}` : useCaseId;
	const { hostRef, instanceRef, ready: editorReady } = useDocumentEditor(useCase, documentKey);

	const transport = useMemo(
		() =>
			new DefaultChatTransport({
				api: '/api/chat',
				prepareSendMessagesRequest: ({ messages, body }) => ({
					body: {
						messages,
						useCase: useCaseId,
						translationTargetLanguage: targetLanguage,
						reviewComments: getReviewCommentsForRequest(messages, body),
					},
				}),
			}),
		[useCaseId, targetLanguage],
	);

	const { messages, sendMessage, addToolOutput, status, error, setMessages, clearError, stop } = useChat({
		transport,
		sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,
		async onToolCall({ toolCall }) {
			if ('dynamic' in toolCall && toolCall.dynamic) {
				return;
			}
			const toolName = toolCall.toolName as AiToolName;
			const failToolCall = (errorText: string) =>
				addToolOutput({ tool: toolName, toolCallId: toolCall.toolCallId, state: 'output-error', errorText });
			const instance = instanceRef.current;
			if (!instance) {
				failToolCall('Document editor is still loading. Please retry in a moment.');
				return;
			}
			try {
				const editorMode = instance.editor.getEditorMode();
				const activeReviewComments = reviewCommentsRef.current;
				const writesDocument = isAiWriteToolName(toolName);
				if (writesDocument && editorMode === 'view') {
					throw new Error('Switch to Edit or Review mode before asking the assistant to change the document.');
				}
				const parsedToolCall = parseAiToolCall(
					{
						id: toolCall.toolCallId,
						name: toolCall.toolName,
						args:
							toolCall.input && typeof toolCall.input === 'object' && !Array.isArray(toolCall.input)
								? (toolCall.input as Record<string, unknown>)
								: {},
					},
					getAiToolDefinitions({ reviewComments: activeReviewComments }),
				);
				const executed = await instance.toolkit.executeTool(
					parsedToolCall,
					writesDocument
						? { writeMode: editorMode === 'review' ? 'track_changes' : 'apply', reviewComments: activeReviewComments }
						: undefined,
				);
				addToolOutput({ tool: parsedToolCall.name, toolCallId: toolCall.toolCallId, output: executed });
			} catch (executionError) {
				failToolCall(getErrorMessage(executionError));
			}
		},
	});

	const isSubmitting = status === 'submitted' || status === 'streaming' || workflowBusy;
	const controlsDisabled = hasHydrated && (isSubmitting || !editorReady);
	const submitDisabled = hasHydrated && (isSubmitting || !editorReady || draftInput.trim().length === 0);

	const timelineLength = messages.reduce((count, message) => count + message.parts.length, 0);
	useEffect(() => {
		const frame = window.requestAnimationFrame(() => {
			const feed = feedRef.current;
			if (feed) {
				feed.scrollTop = feed.scrollHeight;
			}
		});
		return () => {
			window.cancelAnimationFrame(frame);
		};
	}, [timelineLength]);

	useEffect(() => {
		if (!editorReady) {
			return;
		}
		const updateSelection = () => {
			let content: string | null = null;
			try {
				content = instanceRef.current?.editor.getSelectionContent({ format: 'text' }) ?? null;
			} catch {
				content = null;
			}
			if (content) {
				setReviewComments('disabled');
			}
			setSelectionText(content);
		};
		updateSelection();
		const intervalId = window.setInterval(updateSelection, 300);
		return () => {
			window.clearInterval(intervalId);
		};
	}, [editorReady, instanceRef]);

	const resetConversation = () => {
		void stop();
		clearError();
		setMessages([]);
		setDraftInput('');
		setCompletionVisible(false);
		setWorkflowError(null);
		setSelectionText(null);
	};

	const handleUseCaseChange = (nextUseCaseId: AiUseCaseId) => {
		if (isSubmitting || !editorReady || nextUseCaseId === useCaseId) {
			return;
		}
		resetConversation();
		setTranslationNotes('');
		setUseCaseId(nextUseCaseId);
	};

	const handleTargetLanguageChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
		const nextTargetLanguage = event.target.value as TranslationLanguage;
		if (isSubmitting || !editorReady || nextTargetLanguage === targetLanguage) {
			return;
		}
		resetConversation();
		setTargetLanguage(nextTargetLanguage);
	};

	const runWorkflow = async ({ task, scope }: { task: string; scope: 'auto' | 'document' | 'selection' }) => {
		const instance = instanceRef.current;
		if (isSubmitting || !editorReady || !instance) {
			return;
		}
		const isSelectionEdit = scope === 'selection';
		clearError();
		setCompletionVisible(false);
		setWorkflowError(null);
		setWorkflowBusy(true);
		try {
			const editorMode = instance.editor.getEditorMode();
			if (editorMode === 'view') {
				throw new Error(
					isSelectionEdit
						? 'Switch to Edit or Review mode before editing the selection.'
						: 'Switch to Edit or Review mode before running this workflow.',
				);
			}

			const workflow = getAiUseCaseWorkflow(useCaseId, { translationTargetLanguage: targetLanguage });
			const workflowInput = await instance.toolkit.readWorkflowInput(workflow, { scope });
			const response = await fetch('/api/chat', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ useCase: useCaseId, translationTargetLanguage: targetLanguage, task, workflowInput }),
			});
			const responseBody = (await response.json().catch(() => null)) as { error?: unknown; output?: unknown } | null;
			if (!response.ok) {
				const serverError = typeof responseBody?.error === 'string' && responseBody.error.length > 0 ? responseBody.error : undefined;
				throw new Error(serverError ?? (isSelectionEdit ? 'Selected-content request failed.' : 'Workflow request failed.'));
			}
			if (responseBody === null || typeof responseBody !== 'object' || !('output' in responseBody)) {
				throw new Error(
					isSelectionEdit
						? 'Selected-content response did not include structured output.'
						: 'Workflow response did not include structured output.',
				);
			}

			let output: unknown = responseBody.output;
			if (isSelectionEdit) {
				const parsedOutput = workflow.outputSchema.parse(output);
				if (JSON.stringify(parsedOutput.replacementFragment) === JSON.stringify(workflowInput.inputFragment)) {
					setWorkflowError('Clear the selection and try again for edits that need content outside the selection.');
					return;
				}
				output = parsedOutput;
			}

			const writeMode =
				useCaseId === 'template-fields'
					? 'apply'
					: editorMode === 'review'
						? 'track_changes'
						: 'apply';
			await instance.toolkit.applyWorkflowOutput(workflow, output, {
				scope: workflowInput.scope,
				writeMode,
			});
			if (workflowInput.scope === 'document') {
				applyUseCaseEditorSettings(instance.editor, useCase);
			}
			setCompletionVisible(true);
		} catch (runError) {
			setWorkflowError(getErrorMessage(runError));
		} finally {
			setWorkflowBusy(false);
		}
	};

	const handleRunWorkflow = () => {
		const workflow = getAiUseCaseWorkflow(useCaseId, { translationTargetLanguage: targetLanguage });
		const task =
			useCaseId === 'translation' && translationNotes.trim().length > 0
				? `${workflow.defaultTask}\n\nAdditional translation notes: ${translationNotes.trim()}`
				: workflow.defaultTask;
		void runWorkflow({ task, scope: useCaseId === 'template-fields' ? 'document' : 'auto' });
	};

	const submitAssistantPrompt = (rawPrompt: string, options: { forceReviewMode?: boolean } = {}) => {
		const prompt = rawPrompt.trim();
		const instance = instanceRef.current;
		if (!prompt || isSubmitting || !editorReady || !instance) {
			return;
		}
		clearError();
		setCompletionVisible(false);
		setWorkflowError(null);
		if (options.forceReviewMode) {
			instance.editor.setEditorMode('review');
		}
		setDraftInput('');
		if (selectionText) {
			void runWorkflow({ task: prompt, scope: 'selection' });
			return;
		}
		reviewCommentsRef.current = reviewComments;
		sendMessage({ text: prompt, metadata: { reviewComments } }, { body: { reviewComments } });
	};

	const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		submitAssistantPrompt(draftInput);
	};

	const handleResizePointerDown = (event: React.PointerEvent) => {
		event.preventDefault();
		draggingRef.current = true;
		(event.target as HTMLElement).setPointerCapture(event.pointerId);
	};

	const handleResizePointerMove = (event: React.PointerEvent) => {
		if (!draggingRef.current || !layoutRef.current) {
			return;
		}
		const layoutRect = layoutRef.current.getBoundingClientRect();
		setPanelWidth(Math.min(Math.max(event.clientX - layoutRect.left, 260), 600));
	};

	const selectionScopeLabel = selectionText ? (
		<p className="selection-scope-label" data-testid="selection-scope-label">
			{getSelectionScopeLabel(selectionText)}
		</p>
	) : null;

	return (
		<div className="app-frame">
			{chrome ? (
				<header className="app-header">
					<nav>
						<div className="app-header-left">
							<a href="https://nutrient.io" className="app-logo-link">
								{/* eslint-disable-next-line @next/next/no-img-element */}
								<img src="/icons/logo.svg" width={149} height={44} alt="Nutrient" />
							</a>
							<span className="app-tagline">AI-Powered Document Authoring</span>
						</div>
						<div className="app-header-right">
							<a href="https://nutrient.io/sdk/document-authoring/" className="app-header-btn app-header-btn-outline">
								Learn More
							</a>
							<a href="https://nutrient.io/contact-sales/" className="app-header-btn app-header-btn-filled">
								Contact Sales
							</a>
						</div>
					</nav>
				</header>
			) : null}
			<section className="use-case-header" aria-label="Use cases">
				<div className="use-case-controls">
					<div className="use-case-switcher" role="tablist" aria-label="Document Authoring AI use case">
						{USE_CASES.map((candidate) => (
							<button
								key={candidate.id}
								type="button"
								role="tab"
								aria-selected={useCaseId === candidate.id}
								className="use-case-tab"
								disabled={controlsDisabled}
								onClick={() => handleUseCaseChange(candidate.id)}
							>
								{candidate.label}
							</button>
						))}
					</div>
				</div>
			</section>
			<main ref={layoutRef} className="document-authoring-ai-layout" style={{ gridTemplateColumns: `${panelWidth}px 0 1fr` }}>
				{useCaseId === 'ai-editor' ? (
					<section
						aria-label="Legal Assistant"
						className="assistant-panel"
						onWheelCapture={(event) => event.stopPropagation()}
						onTouchMoveCapture={(event) => event.stopPropagation()}
					>
						<header className="panel-heading">
							<h2>Legal Assistant</h2>
							<p>Review this Mutual NDA, flag open issues, and prepare focused edits for counsel.</p>
						</header>
						<div ref={feedRef} className="bubble-feed" data-testid="assistant-bubble-feed">
							{messages.length === 0 ? (
								<section className="assistant-prompt-shortcuts" aria-label="Sample legal prompts">
									<div className="assistant-prompt-group">
										<h3>Ask About The Draft</h3>
										<div className="assistant-prompt-buttons">
											{ASSISTANT_QUERY_PROMPTS.map((shortcut) => (
												<button
													key={shortcut.label}
													type="button"
													disabled={controlsDisabled}
													onClick={() => submitAssistantPrompt(shortcut.prompt)}
												>
													{shortcut.label}
												</button>
											))}
										</div>
									</div>
									<div className="assistant-prompt-group">
										<h3>Revise The Draft</h3>
										<div className="assistant-prompt-buttons">
											{ASSISTANT_MODIFICATION_PROMPTS.map((shortcut) => (
												<button
													key={shortcut.label}
													type="button"
													disabled={controlsDisabled}
													onClick={() => submitAssistantPrompt(shortcut.prompt, { forceReviewMode: shortcut.forceReviewMode })}
												>
													{shortcut.label}
												</button>
											))}
										</div>
									</div>
								</section>
							) : null}
							{messages.map((message) =>
								message.parts.map((part, partIndex) => {
									const key = `${message.id}-${partIndex}`;
									if (part.type === 'text' && part.text) {
										return (
											<article key={key} className={`bubble bubble-${message.role}`}>
												<strong>{message.role === 'user' ? 'You' : 'Assistant'}</strong>
												{message.role === 'assistant' ? <AssistantMarkdown text={part.text} /> : <p>{part.text}</p>}
											</article>
										);
									}
									if (part.type.startsWith('tool-') && 'toolCallId' in part) {
										const name = part.type.slice('tool-'.length);
										const toolStatus =
											part.state === 'output-available' ? 'success' : part.state === 'output-error' ? 'error' : 'running';
										return (
											<article key={key} className={`bubble bubble-tool bubble-tool-${toolStatus}`} data-testid="tool-log-entry">
												<div className="tool-log-heading">
													<strong>Tool</strong>
												</div>
												<p>{name}</p>
												<details className="tool-log-details" data-testid="tool-log-details">
													<summary>Show tool call</summary>
													<pre className="tool-args" data-testid="tool-log-args">
														{formatJson({ id: part.toolCallId, name, args: part.input })}
													</pre>
												</details>
												{part.state === 'output-error' && part.errorText ? <p>{part.errorText}</p> : null}
											</article>
										);
									}
									return null;
								}),
							)}
							{error ? (
								<article className="bubble bubble-assistant">
									<strong>Assistant</strong>
									<p>{error.message}</p>
								</article>
							) : null}
						</div>

						<form className="assistant-form" onSubmit={handleSubmit}>
							{selectionScopeLabel ?? (
								<label className="assistant-option">
									<input
										type="checkbox"
										checked={reviewComments === 'create'}
										disabled={controlsDisabled}
										onChange={(event) => setReviewComments(event.target.checked ? 'create' : 'disabled')}
									/>
									<span>Add notes explaining AI edits</span>
								</label>
							)}
							<label htmlFor="assistant-input" className="sr-only">
								Ask assistant
							</label>
							<textarea
								id="assistant-input"
								name="assistant-input"
								value={draftInput}
								onChange={(event) => setDraftInput(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === 'Enter' && !event.shiftKey) {
										event.preventDefault();
										event.currentTarget.form?.requestSubmit();
									}
								}}
								rows={3}
								disabled={controlsDisabled}
								placeholder="What do you want to do to the contract?"
							/>
							<div className="assistant-form-actions">
								<button type="submit" disabled={submitDisabled}>
									{isSubmitting ? 'Submitting...' : 'Submit'}
								</button>
							</div>
						</form>
					</section>
				) : null}

				{useCase.panel ? (
					<section
						aria-label={useCase.panel.title}
						className="workflow-panel"
						onWheelCapture={(event) => event.stopPropagation()}
						onTouchMoveCapture={(event) => event.stopPropagation()}
					>
						<header className="panel-heading">
							<h2>{useCase.panel.title}</h2>
							<p>{useCase.panel.description}</p>
						</header>
						<div className="workflow-panel-content">
							{useCase.panel.withSelectionScope ? selectionScopeLabel : null}
							{useCaseId === 'translation' ? (
								<>
									<label className="workflow-field" htmlFor="translation-target-language">
										<span>Target language</span>
										<select
											id="translation-target-language"
											name="translation-target-language"
											value={targetLanguage}
											disabled={controlsDisabled}
											onChange={handleTargetLanguageChange}
										>
											{TRANSLATION_TARGET_LANGUAGES.map((language) => (
												<option key={language.id} value={language.id}>
													{language.label}
												</option>
											))}
										</select>
									</label>
									<label className="workflow-field" htmlFor="translation-notes">
										<span>Translation notes</span>
										<textarea
											id="translation-notes"
											name="translation-notes"
											value={translationNotes}
											maxLength={500}
											rows={4}
											disabled={controlsDisabled}
											placeholder="e.g., preserve legal terms, use formal phrasing..."
											onChange={(event) => setTranslationNotes(event.target.value)}
										/>
										<small>{`${translationNotes.length}/500`}</small>
									</label>
								</>
							) : null}
							<div className="workflow-actions">
								<button type="button" onClick={handleRunWorkflow} disabled={controlsDisabled}>
									{workflowBusy
										? useCase.panel.busy
										: useCase.panel.withSelectionScope && selectionText
											? useCase.panel.selectionAction
											: useCase.panel.documentAction}
								</button>
							</div>
							{useCaseId === 'template-fields' ? (
								<section className="template-fields-catalog" aria-label="Placeholder catalog">
									<h3>Placeholder Catalog</h3>
									{TEMPLATE_FIELD_CATALOG.map((group) => (
										<section key={group.id} className="template-field-group" aria-labelledby={`template-field-group-${group.id}`}>
											<h3 id={`template-field-group-${group.id}`}>{group.label}</h3>
											<ul>
												{group.fields.map((field) => (
													<li key={field.path}>
														<span className="template-field-label">{field.label}</span>
														<code>{`{{${field.path}}}`}</code>
														<span className="template-field-description">{field.description}</span>
													</li>
												))}
											</ul>
										</section>
									))}
								</section>
							) : null}
						</div>
					</section>
				) : null}

				<div
					className="resize-handle"
					onPointerDown={handleResizePointerDown}
					onPointerMove={handleResizePointerMove}
					onPointerUp={() => {
						draggingRef.current = false;
					}}
				/>

				<section aria-label="Document Editor" className="editor-panel">
					<div className="editor-host-wrap">
						<div ref={hostRef} className="editor-host" data-testid="document-editor-host" />
					</div>
				</section>
			</main>
			{completionVisible ? (
				<div className="workflow-completion-toast" role="status" aria-live="polite">
					<div>
						<strong>{useCase.completion.title}</strong>
					</div>
					<button type="button" aria-label={useCase.completion.dismissLabel} onClick={() => setCompletionVisible(false)}>
						Close
					</button>
				</div>
			) : null}
			{workflowError ? (
				<div className="workflow-completion-toast" role="alert">
					<div>
						<strong>Workflow failed</strong>
						<p>{workflowError}</p>
					</div>
					<button type="button" aria-label="Dismiss workflow error" onClick={() => setWorkflowError(null)}>
						Close
					</button>
				</div>
			) : null}
		</div>
	);
}
