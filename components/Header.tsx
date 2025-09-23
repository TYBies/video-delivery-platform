'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function Header() {
  const pathname = usePathname()

  return (
    <header className="header">
      <div className="header-content">
        <h1>Videographer Platform</h1>
        {pathname !== '/' && (
          <Link href="/" className="btn btn-secondary">
            <span>← Back to Dashboard</span>
          </Link>
        )}
      </div>
    </header>
  )
}