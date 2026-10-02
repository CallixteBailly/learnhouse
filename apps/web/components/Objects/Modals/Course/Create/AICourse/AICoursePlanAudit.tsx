'use client'

// apps/web/components/Objects/Modals/Course/Create/AICourse/AICoursePlanAudit.tsx
//
// Completeness card for the AI course-planning preview. Calls the
// /ai/courseplanning/audit endpoint (TypeSafe/Jev typed judgments) whenever
// the plan changes and shows: a completeness score, the failing convention
// checks, and the single most useful question to ask next. Fully
// best-effort: when Jev is unavailable the card simply disappears.

import React, { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldCheck, ShieldAlert, Loader2 } from 'lucide-react'
import { auditCoursePlan, PlanAudit } from '@services/ai/courseplanning'
import type { CoursePlan } from '@services/ai/courseplanning'

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-300 bg-green-500/15 border-green-500/30'
  if (score >= 40) return 'text-amber-300 bg-amber-500/15 border-amber-500/30'
  return 'text-red-300 bg-red-500/15 border-red-500/30'
}

export function AICoursePlanAudit({
  plan,
  accessToken,
}: {
  plan: CoursePlan | null
  accessToken: string
}) {
  const { t } = useTranslation()
  const [audit, setAudit] = useState<PlanAudit | null>(null)
  const [isAuditing, setIsAuditing] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Debounced re-audit on plan change (the plan object updates after each
  // AI iteration, not on every keystroke).
  useEffect(() => {
    if (!plan) return
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(async () => {
      setIsAuditing(true)
      const result = await auditCoursePlan(plan, accessToken)
      setAudit(result)
      setIsAuditing(false)
    }, 1200)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [JSON.stringify(plan), accessToken])

  if (!plan) return null
  if (isAuditing && !audit) {
    return (
      <div className="flex items-center gap-2 px-4 py-2 text-xs text-white/40 border-b border-white/5">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        {t('courses.create.ai.audit_loading', {
          defaultValue: 'Analyse de complétude du plan…',
        })}
      </div>
    )
  }

  if (!audit || !audit.enabled) return null

  const score = audit.completeness.score
  const failing = audit.checks.filter((c) => !c.ok)
  const passingCount = audit.checks.length - failing.length
  const isComplete = audit.next_missing.topic === 'rien' || (score !== null && score >= 90)

  return (
    <div className="border-b border-white/5 bg-white/[0.02]">
      <div className="flex items-center gap-3 px-4 py-2.5">
        {isComplete ? (
          <ShieldCheck className="w-4 h-4 text-green-300 shrink-0" />
        ) : (
          <ShieldAlert className="w-4 h-4 text-amber-300 shrink-0" />
        )}
        <span className="text-xs font-semibold text-white/80 shrink-0">
          {t('courses.create.ai.audit_title', { defaultValue: 'Complétude de la formation' })}
        </span>
        {score !== null && (
          <span
            className={`px-2 py-0.5 rounded-full border text-[10px] font-bold shrink-0 ${scoreColor(score)}`}
          >
            {score}/100
          </span>
        )}
        <span className="text-[10px] text-white/35 truncate">
          {passingCount}/{audit.checks.length}{' '}
          {t('courses.create.ai.audit_checks_passed', { defaultValue: 'conventions respectées' })}
          {isAuditing && <Loader2 className="w-3 h-3 animate-spin inline ml-1.5" />}
        </span>
      </div>

      {failing.length > 0 && (
        <div className="px-4 pb-2 -mt-0.5">
          <ul className="space-y-0.5">
            {failing.slice(0, 5).map((check) => (
              <li key={check.id} className="flex items-center gap-2 text-[11px] text-white/50">
                <span className="w-1 h-1 rounded-full bg-amber-400/70 shrink-0" />
                {check.label}
              </li>
            ))}
            {failing.length > 5 && (
              <li className="text-[10px] text-white/30 pl-3">
                +{failing.length - 5}
              </li>
            )}
          </ul>
        </div>
      )}

      {audit.recommendation && !isComplete && (
        <div className="px-4 pb-2.5 text-[11px] text-white/60 italic">
          {t('courses.create.ai.audit_next', { defaultValue: 'À demander :' })}{' '}
          {audit.recommendation}
        </div>
      )}
    </div>
  )
}

export default AICoursePlanAudit
