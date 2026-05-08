import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'FreeCode',
  description: 'AI-assisted coding via your ChatGPT/Claude session',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}