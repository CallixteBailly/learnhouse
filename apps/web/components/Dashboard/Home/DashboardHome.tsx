'use client'
import React from 'react'
import Link from 'next/link'
import {
  PlusCircle,
  ChartBar,
  GearSix,
  Users,
  BookOpen,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query/keys'
import { useTranslation } from 'react-i18next'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useOrg } from '@components/Contexts/OrgContext'
import { getAPIUrl } from '@services/config/config'
import { OrgUsageResponse, orgUsageFetcher } from '@services/orgs/usage'
import AdminAuthorization from '@components/Security/AdminAuthorization'
import { usePlan } from '@components/Hooks/usePlan'
import QuickStats from './QuickStats'
import RecentCourses from './RecentCourses'
import RecentMembers from './RecentMembers'
import ContentOverview from './ContentOverview'
import UsageOverview from './UsageOverview'

const PLAN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  free: { bg: 'bg-gray-100', text: 'text-gray-600', border: 'border-gray-200' },
  oss: { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' },
  standard: { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' },
  pro: { bg: 'bg-purple-100', text: 'text-purple-700', border: 'border-purple-200' },
  enterprise: { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' },
}

export default function DashboardHome() {
  const { t } = useTranslation()
  const session = useLHSession() as any
  const org = useOrg() as any

  const token = session?.data?.tokens?.access_token
  const orgId = org?.id
  const username = session?.data?.user?.username || ''

  // TanStack Query will dedupe with UsageOverview's identical call via shared queryKey
  const { data: usageData } = useQuery<OrgUsageResponse>({
    queryKey: queryKeys.org.usage(orgId),
    queryFn: () => orgUsageFetcher(`${getAPIUrl()}orgs/${orgId}/usage`, token),
    enabled: !!token && !!orgId,
    staleTime: 60_000,
  })

  const plan = usePlan()
  const planStyle = PLAN_COLORS[plan] || PLAN_COLORS.free

  return (
    <div className="h-full w-full bg-[#f7f7f7]">
      <div className="px-4 sm:px-10 pt-8 pb-10">
        <div className="space-y-6 max-w-[1600px] mx-auto w-full">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-3xl font-black text-[#3c3c3c]" style={{ fontFamily: 'var(--font-display, Nunito)' }}>
                {t('dashboard.home.welcome_back')}{username ? `, ${username}` : ''}!
              </h1>
              <div className="flex items-center gap-2 mt-2">
                <span
                  className={`text-[11px] font-bold px-2.5 py-1 rounded-full capitalize ${planStyle.bg} ${planStyle.text} border-2 ${planStyle.border}`}
                >
                  {plan === 'oss' ? 'OSS' : `${plan} ${t('dashboard.home.plan')}`}
                </span>
                {org?.name && (
                  <span className="text-xs text-[#afafaf] font-semibold">{org.name}</span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={() => window.location.href = '/dash/courses?new=true'}
                className="duo-btn-success"
                style={{ height: '40px', fontSize: '13px' }}
              >
                <PlusCircle size={16} weight="bold" />
                {t('dashboard.home.create_course')}
              </button>
              <Link
                href="/dash/analytics"
                className="duo-btn-white"
                style={{ height: '40px', fontSize: '13px' }}
              >
                <ChartBar size={16} weight="bold" />
                {t('dashboard.home.analytics')}
              </Link>
              <Link
                href="/dash/users/settings/users"
                className="duo-btn-white"
                style={{ height: '40px', fontSize: '13px' }}
              >
                <Users size={16} weight="bold" />
                {t('dashboard.home.members')}
              </Link>
              <Link
                href="/dash/org/settings/general"
                className="duo-btn-white"
                style={{ height: '40px', fontSize: '13px' }}
              >
                <GearSix size={16} weight="bold" />
                {t('dashboard.home.settings')}
              </Link>
            </div>
          </div>

          <AdminAuthorization authorizationMode="component">
            <div className="space-y-6">
              {/* Content counts row */}
              <ContentOverview />

              {/* Main grid: courses + members + usage */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                  <RecentCourses />
                  <RecentMembers />
                </div>
                <div className="space-y-6">
                  <UsageOverview />
                  <QuickStats />
                </div>
              </div>
            </div>
          </AdminAuthorization>
        </div>
      </div>
    </div>
  )
}
