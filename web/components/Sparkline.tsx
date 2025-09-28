"use client"
import { motion } from 'framer-motion'

export function Sparkline({ data, color = '#60a5fa' }: { data: number[], color?: string }){
  const w = 280, h = 60
  const min = Math.min(...data)
  const max = Math.max(...data)
  const scaleX = (i: number) => (i / Math.max(1, data.length - 1)) * w
  const scaleY = (v: number) => h - ((v - min) / Math.max(1e-9, max - min)) * h
  const d = data.map((v, i) => `${i === 0 ? 'M' : 'L'} ${scaleX(i)} ${scaleY(v)}`).join(' ')
  return (
    <motion.svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="mt-2">
      <path d={d} fill="none" stroke={color} strokeWidth={2} />
    </motion.svg>
  )
}
