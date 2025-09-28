"use client"
import { motion } from 'framer-motion'
import { ReactNode } from 'react'

export function Card({ title, action, children }: { title?: ReactNode, action?: ReactNode, children: ReactNode }){
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}
      className="glass p-4">
      {(title || action) && (
        <div className="flex items-center mb-3">
          {title && <div className="text-sm uppercase tracking-wider text-gray-400">{title}</div>}
          <div className="ml-auto">{action}</div>
        </div>
      )}
      {children}
    </motion.div>
  )
}
