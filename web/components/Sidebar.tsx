"use client"
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { FiHome, FiList, FiCalendar, FiBarChart2, FiSettings } from 'react-icons/fi'

const nav = [
  { href: '/', label: 'Home', icon: FiHome },
  { href: '/watchlist', label: 'Watchlist', icon: FiList },
  { href: '/calendar', label: 'Calendar', icon: FiCalendar },
  { href: '/analysis', label: 'Analysis', icon: FiBarChart2 },
  { href: '/settings', label: 'Settings', icon: FiSettings },
]

export function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="fixed left-0 top-0 h-full w-20 md:w-64 p-4 space-y-2 glass">
      <div className="text-xl font-bold mb-4 hidden md:block">Market Insights</div>
      <nav className="flex flex-col gap-1">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href} className={`flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-white/5 ${active ? 'bg-white/10' : ''}`}>
              <Icon className="text-gray-300" />
              <span className="hidden md:inline text-sm text-gray-200">{label}</span>
            </Link>
          )
        })}
      </nav>
    </aside>
  )
}
