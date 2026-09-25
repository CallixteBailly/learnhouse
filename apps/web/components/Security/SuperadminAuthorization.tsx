'use client'
import React, { useEffect, useState, useCallback, useMemo } from 'react'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import { useRouter } from 'next/navigation'
import PageLoading from '@components/Objects/Loaders/PageLoading'

type SuperadminAuthorizationProps = {
  children: React.ReactNode
}

const SuperadminAuthorization: React.FC<SuperadminAuthorizationProps> = ({
  children,
}) => {
  const session = useLHSession() as any
  const router = useRouter()
  const [isAuthorized, setIsAuthorized] = useState(false)
  const [isChecking, setIsChecking] = useState(true)

  const isUserAuthenticated = useMemo(
    () => session.status === 'authenticated',
    [session.status]
  )

  const checkAuth = useCallback(() => {
    if (session.status === 'loading') return

    if (!isUserAuthenticated) {
      router.push('/admin/login')
      return
    }

    const isSuperadmin = session?.data?.user?.is_superadmin === true
    if (isSuperadmin) {
      setIsAuthorized(true)
    } else {
      setIsAuthorized(false)
    }
    setIsChecking(false)
  }, [session.status, isUserAuthenticated, session?.data?.user?.is_superadmin, router])

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (session.status === 'loading' || isChecking) {
    return (
      <div className="flex justify-center items-center h-screen">
        <PageLoading />
      </div>
    )
  }

  // Ordria self-hosted: the superadmin dashboard is unlocked in OSS — this
  // deployment is a multi-tenant LMS and org/user administration is a core
  // operator need (same OSS-native unlock as Audit Logs / Analytics on the
  // API side). Authorization still requires is_superadmin below.
  if (!isAuthorized) {
    return (
      <div className="flex justify-center items-center h-screen bg-[#0f0f10]">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-white mb-2">Access Denied</h1>
          <p className="text-white/50">
            You need superadmin privileges to access this page.
          </p>
        </div>
      </div>
    )
  }

  return <>{children}</>
}

export default SuperadminAuthorization
