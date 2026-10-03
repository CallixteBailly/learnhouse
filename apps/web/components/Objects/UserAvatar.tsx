import React, { useEffect, useState } from 'react'
import { getUserAvatarMediaDirectory } from '@services/media/media'
import { useLHSession } from '@components/Contexts/LHSessionContext'
import UserProfilePopup from './UserProfilePopup'
import { getUserByUsername, getUser } from '@services/users/users'

type UserAvatarProps = {
  width?: number
  avatar_url?: string
  use_with_session?: boolean
  rounded?: 'rounded-md' | 'rounded-xl' | 'rounded-lg' | 'rounded-full' | 'rounded'
  border?: 'border-2' | 'border-4' | 'border-8'
  borderColor?: string
  predefined_avatar?: 'ai' | 'empty'
  backgroundColor?: 'bg-white' | 'bg-gray-100'
  showProfilePopup?: boolean
  userId?: string
  username?: string
  shadow?: string
}

function UserAvatar(props: UserAvatarProps) {
  const session = useLHSession() as any
  const access_token = session?.data?.tokens?.access_token
  const [userData, setUserData] = useState<any>(null)
  // Degradation chain: 0 = resolved avatar, 1 = /empty_avatar.png, 2 = inline SVG.
  const [fallbackStage, setFallbackStage] = useState(0)

  useEffect(() => {
    const fetchUserData = async () => {
      // Skip fetching if no access token (user not authenticated)
      if (!access_token) return
      // Skip fetching if avatar is already determined · the popup will fetch its own data
      if (props.avatar_url || props.predefined_avatar) return

      if (props.username) {
        try {
          const data = await getUserByUsername(props.username, access_token)
          setUserData(data)
        } catch (error) {
          console.error('Error fetching user by username:', error)
        }
      } else if (props.userId) {
        try {
          const data = await getUser(props.userId, access_token)
          setUserData(data)
        } catch (error) {
          console.error('Error fetching user by ID:', error)
        }
      }
    }

    fetchUserData()
  }, [props.username, props.userId, access_token, props.avatar_url, props.predefined_avatar])

  const isExternalUrl = (url: string): boolean => {
    return url.startsWith('http://') || url.startsWith('https://')
  }

  const extractExternalUrl = (url: string): string | null => {
    // Check if the URL contains an embedded external URL
    const matches = url.match(/avatars\/(https?:\/\/[^/]+.*$)/)
    if (matches && matches[1]) {
      return matches[1]
    }
    return null
  }

  const getAvatarUrl = (): string => {
    // If predefined avatar is specified.
    // Static assets live at the site root (/empty_avatar.png) — never route
    // them through getUriWithOrg, which prefixes /orgs/{slug} for pages and
    // would turn the asset URL into a 404 org route.
    if (props.predefined_avatar) {
      const avatarType = props.predefined_avatar === 'ai' ? '/ai_avatar.png' : '/empty_avatar.png'
      return avatarType
    }

    // If avatar_url prop is provided
    if (props.avatar_url) {
      // Check if it's a malformed URL (external URL processed through getUserAvatarMediaDirectory)
      const extractedUrl = extractExternalUrl(props.avatar_url)
      if (extractedUrl) {
        return extractedUrl
      }
      // If it's a direct external URL
      if (isExternalUrl(props.avatar_url)) {
        return props.avatar_url
      }
      // Otherwise use as is
      return props.avatar_url
    }

    // If we have user data from userId/username fetch
    if (userData?.avatar_image) {
      const avatarUrl = userData.avatar_image
      // If it's an external URL (e.g., from Google, Facebook, etc.), use it directly
      if (isExternalUrl(avatarUrl)) {
        return avatarUrl
      }
      // Otherwise, get the local avatar URL
      return getUserAvatarMediaDirectory(userData.user_uuid, avatarUrl)
    }

    // If a specific userId or username was requested but user has no avatar,
    // don't fall back to session avatar - use empty avatar instead
    if (props.userId || props.username) {
      return '/empty_avatar.png'
    }

    // Only use session avatar when no specific user is requested
    if (session?.data?.user?.avatar_image) {
      const avatarUrl = session.data.user.avatar_image
      // If it's an external URL (e.g., from Google, Facebook, etc.), use it directly
      if (isExternalUrl(avatarUrl)) {
        return avatarUrl
      }
      // Otherwise, get the local avatar URL
      return getUserAvatarMediaDirectory(session.data.user.user_uuid, avatarUrl)
    }

    // Fallback to empty avatar
    return '/empty_avatar.png'
  }

  // Root static asset — deliberately NOT org-prefixed (see getAvatarUrl).
  const emptyAvatarUrl = '/empty_avatar.png'
  // Last-resort inline placeholder so a broken image icon never shows, even
  // if the static asset itself fails to load.
  const inlineFallbackAvatar =
    'data:image/svg+xml;utf8,' +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e5e7eb"/><circle cx="32" cy="24" r="10" fill="#9ca3af"/><path d="M12 56c2-11 10-17 20-17s18 6 20 17" fill="#9ca3af"/></svg>`
    )
  const resolvedAvatarUrl = getAvatarUrl()
  // Restart the fallback chain whenever the resolved source changes.
  useEffect(() => {
    setFallbackStage(0)
  }, [resolvedAvatarUrl])
  const displaySrc =
    fallbackStage === 0 ? resolvedAvatarUrl : fallbackStage === 1 ? emptyAvatarUrl : inlineFallbackAvatar

  const avatarImage = (
    <img
      alt="User Avatar"
      width={props.width ?? 50}
      height={props.width ?? 50}
      src={displaySrc}
      onError={() => {
        // Advance the fallback chain: user avatar → /empty_avatar.png → inline SVG
        setFallbackStage((s) => Math.min(s + 1, 2))
      }}
      className={`
        ${props.avatar_url && session?.data?.user?.avatar_image ? '' : 'bg-gray-700'}
        ${props.border ? `border ${props.border}` : ''}
        ${props.borderColor ?? 'border-white'}
        ${props.backgroundColor ?? 'bg-gray-100'}
        ${props.shadow ?? 'shadow-md shadow-gray-300/45'}
        aspect-square
        w-[${props.width ?? 50}px]
        h-[${props.width ?? 50}px]
        ${props.rounded ?? 'rounded-xl'}
      `}
    />
  )

  if (props.showProfilePopup && (props.userId || (userData?.id))) {
    return (
      <UserProfilePopup userId={props.userId || userData?.id}>
        {avatarImage}
      </UserProfilePopup>
    )
  }

  return avatarImage
}

export default UserAvatar
