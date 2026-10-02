import React from 'react'
import type { Metadata } from 'next'
import JobTitleList from '@components/Admin/JobTitleList'

export const metadata: Metadata = {
  title: 'Job titles',
}

export default function AdminJobTitlesPage() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white">Job titles</h1>
        <p className="text-white/40 mt-1">
          Catalog of job titles offered on the signup form (platform-wide)
        </p>
      </div>
      <JobTitleList />
    </div>
  )
}
