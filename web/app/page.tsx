"use client"
import { Sidebar } from '@/components/Sidebar'
import { Card } from '@/components/Card'
import { Sparkline } from '@/components/Sparkline'
import { motion } from 'framer-motion'
import { FiExternalLink, FiTrendingUp, FiTrendingDown } from 'react-icons/fi'

function Chip({ label, tone = 'info' }: { label: string, tone?: 'info'|'positive'|'negative'|'neutral' }){
  const color = tone === 'positive' ? 'bg-emerald-500/20 text-emerald-300' : tone === 'negative' ? 'bg-rose-500/20 text-rose-300' : 'bg-sky-500/20 text-sky-300'
  return <span className={`text-xs px-2 py-0.5 rounded-full ${color}`}>{label}</span>
}

export default function Page(){
  // Demo placeholders; wire up with API in follow-ups
  const pairs = [
    { s: 'EURUSD', px: 1.0742, ch: +0.24 },
    { s: 'GBPUSD', px: 1.2681, ch: -0.12 },
    { s: 'XAUUSD', px: 2450.14, ch: +0.56 },
  ]
  const spark = [1,1.1,1.05,1.2,1.18,1.22,1.15]
  const news = [
    { t: 'ECB commentary hints at path-dependent policy', imp: 'High', url: '#', src: 'DemoWire' },
    { t: 'US labor data surprises markets', imp: 'Medium', url: '#', src: 'DemoWire' },
  ]
  const calendar = [
    { c: 'US', e: 'Nonfarm Payrolls', imp: 'High', time: '2025-10-03 12:30Z' },
    { c: 'EU', e: 'CPI YoY (Flash)', imp: 'High', time: '2025-10-01 09:00Z' },
  ]

  return (
    <div className="min-h-screen pl-20 md:pl-64">
      <Sidebar />
      <main className="p-6 md:p-10">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight mb-6">Trading Dashboard</h1>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-6">
            <Card title="Watchlist">
              <table className="w-full text-sm">
                <thead className="text-gray-400">
                  <tr>
                    <th className="text-left font-medium pb-2">Pair</th>
                    <th className="text-right font-medium pb-2">Price</th>
                    <th className="text-right font-medium pb-2">Change</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {pairs.map(p=>{
                    const up = p.ch >= 0
                    return (
                      <tr key={p.s} className="hover:bg-white/5">
                        <td className="py-2 font-semibold flex items-center gap-2">
                          {/* TODO: flag icons */}
                          <span>{p.s}</span>
                        </td>
                        <td className="py-2 text-right">{p.px.toFixed(p.s.startsWith('XA')?2:5)}</td>
                        <td className={`py-2 text-right font-medium ${up?'text-emerald-400':'text-rose-400'}`}>{up?'+':''}{p.ch.toFixed(2)}%</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </Card>

            <Card title="Analyses" action={<button className="text-xs px-2 py-1 rounded-md bg-sky-500/20 text-sky-300">Ask GPT</button>}>
              <div className="space-y-2 text-sm">
                <details className="bg-black/20 rounded-md p-3">
                  <summary className="cursor-pointer font-semibold">Daily outlook — EURUSD</summary>
                  <p className="mt-2 text-gray-300">Strong resistance into 1.08 handle; watch for liquidity sweep and OTE retrace. Risk around NFP.</p>
                </details>
                <details className="bg-black/20 rounded-md p-3">
                  <summary className="cursor-pointer font-semibold">Weekly outlook — XAUUSD</summary>
                  <p className="mt-2 text-gray-300">Premium PD arrays; look for sell-side liquidity draw towards prior CE before continuation.</p>
                </details>
              </div>
            </Card>
          </div>

          <div className="lg:col-span-2 space-y-6">
            <Card title="Last Quote">
              <div className="text-center">
                <div className="text-5xl md:text-6xl font-extrabold tracking-tight">1.0742 <FiTrendingUp className="inline text-emerald-400" /></div>
                <div className="text-sm text-gray-400 mt-1">EURUSD — +0.24%</div>
                <Sparkline data={spark} color="#22c55e" />
              </div>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <Card title="News">
                <div className="grid gap-3">
                  {news.map((n,i)=> (
                    <motion.a key={i} href={n.url} target="_blank" className="block p-3 rounded-lg bg-black/20 hover:bg-black/30 transition-colors">
                      <div className="flex items-start gap-3">
                        <div className={`mt-1 ${n.imp==='High'?'text-rose-400':'text-amber-300'}`}>{n.imp==='High'?<FiTrendingDown/>:<FiTrendingUp/>}</div>
                        <div className="flex-1">
                          <div className="font-medium">{n.t}</div>
                          <div className="text-xs text-gray-400 mt-1 flex items-center gap-2">
                            <Chip label={n.imp} tone={n.imp==='High'?'negative':'info'} />
                            <span>{n.src}</span>
                            <FiExternalLink className="opacity-70" />
                          </div>
                        </div>
                      </div>
                    </motion.a>
                  ))}
                </div>
              </Card>

              <Card title="Macro Calendar">
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-px bg-white/10" />
                  <div className="space-y-5">
                    {calendar.map((c, i)=> (
                      <div key={i} className="pl-10 relative">
                        <div className={`absolute left-3 top-1.5 w-3 h-3 rounded-full ${c.imp==='High'?'bg-rose-400':'bg-amber-300'}`} />
                        <div className="text-sm font-semibold">{c.e} <span className="text-xs text-gray-400">({c.c})</span></div>
                        <div className="text-xs text-gray-400">{c.time}</div>
                        <div className="mt-1"><Chip label={c.imp} tone={c.imp==='High'?'negative':'info'} /></div>
                      </div>
                    ))}
                  </div>
                </div>
              </Card>
            </div>

            <Card title="Entry Plan" action={<button className="text-xs px-2 py-1 rounded-md bg-amber-500/20 text-amber-300">Generate Plan</button>}>
              <div className="grid gap-3">
                <div className="text-sm text-gray-300">Drag-and-drop screenshots (up to 5) below. Add tags to group plans.</div>
                <div className="border-2 border-dashed border-white/10 rounded-xl p-6 text-center text-sm text-gray-400">Drop screenshots here</div>
                <div className="flex gap-2">
                  {[1,2].map(i=> <div key={i} className="w-24 h-16 bg-black/30 rounded-lg" />)}
                </div>
                <div className="mt-2">
                  <div className="text-xs uppercase text-gray-400 mb-2">History</div>
                  <div className="space-y-2">
                    {[1,2,3].map(i=> (
                      <div key={i} className="p-3 rounded-lg bg-black/20">
                        <div className="flex items-center gap-2 text-xs text-gray-400 mb-1">
                          <span className="px-2 py-0.5 bg-sky-500/20 text-sky-300 rounded-full">ICT</span>
                          <span className="px-2 py-0.5 bg-emerald-500/20 text-emerald-300 rounded-full">Long</span>
                          <span>2025-09-27 10:12</span>
                        </div>
                        <div className="text-sm">Sweep SSL → displacement up → OTE 62–79% into FVG; stop below swing; take BSL into prior high.</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </main>
    </div>
  )
}
