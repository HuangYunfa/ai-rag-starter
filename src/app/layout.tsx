import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'AI 知识库助手',
  description: '基于 RAG 的智能知识库问答系统',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}

