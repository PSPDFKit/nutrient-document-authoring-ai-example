import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
	title: 'Document Authoring SDK: AI Editing',
	description: 'LLM-driven document authoring with visible tool execution.',
	icons: {
		icon: '/favicon.ico',
	},
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body>{children}</body>
		</html>
	);
}
