import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Videographer Platform',
  description: 'Upload and share videos with clients',
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