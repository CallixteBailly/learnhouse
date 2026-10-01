import { getOrganizationContextInfo } from '@services/organizations/orgs'
import { Metadata } from 'next'
import { getOrgThumbnailMediaDirectory } from '@services/media/media'
import AccountClient from '@components/Objects/Account/AccountClient'
import { redirect } from 'next/navigation'

type MetadataProps = {
  params: Promise<{ orgslug: string; subpage: string }>
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>
}

const VALID_SUBPAGES = ['general', 'profile', 'security', 'purchases']

const getSubpageTitle = (subpage: string): string => {
  const titles: Record<string, string> = {
    'general': 'General Settings',
    'profile': 'Profile Builder',
    'security': 'Security',
    'purchases': 'Purchases',
  }
  return titles[subpage] || 'Account'
}

export async function generateMetadata(props: MetadataProps): Promise<Metadata> {
  const params = await props.params
  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  const title = `${getSubpageTitle(params.subpage)} · ${org.name}`
  const description = `Manage your account settings at ${org.name}`

  return {
    title,
    description,
    robots: {
      index: false,
      follow: false,
    },
    openGraph: {
      title,
      description,
      type: 'website',
      images: [
        {
          url: getOrgThumbnailMediaDirectory(org?.org_uuid, org?.thumbnail_image),
          width: 800,
          height: 600,
          alt: org.name,
        },
      ],
    },
  }
}

const AccountSubPage = async (props: { params: Promise<{ orgslug: string; subpage: string }> }) => {
  const params = await props.params

  // No server-side session gate here. getServerSession() can transiently
  // return null while the client session is perfectly valid (access-token
  // expiry racing the client's /api/auth/refresh rotation, or a flaky
  // /users/session upstream call) — and redirecting to /login in that window
  // used to EJECT logged-in users from their own profile page (the login
  // page bounces authenticated visitors to /home). AccountClient performs
  // the unauthenticated check client-side, with the same session source the
  // login page uses, so the two can never disagree and loop.
  //
  // Browser-relative redirects only: the org slug is NEVER a URL path segment
  // (the proxy adds the /orgs/{slug} prefix). A slug-prefixed path would be
  // double-prefixed by the proxy → 404.

  // Redirect to general if invalid subpage
  if (!VALID_SUBPAGES.includes(params.subpage)) {
    redirect('/account/general')
  }

  const org = await getOrganizationContextInfo(params.orgslug, {
    revalidate: 120,
    tags: ['organizations'],
  })

  return (
    <AccountClient
      orgslug={params.orgslug}
      org_id={org.id}
      subpage={params.subpage}
    />
  )
}

export default AccountSubPage
