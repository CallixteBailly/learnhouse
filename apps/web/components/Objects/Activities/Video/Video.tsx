import React, { useState, useEffect } from 'react'
import YouTube from 'react-youtube'
import { useOrg } from '@components/Contexts/OrgContext'
import LearnHousePlayer from './LearnHousePlayer'
import AdaptiveVideoShell from './AdaptiveVideoShell'
import {
  isActivityHlsReady,
  resolveActivityVideoSource,
  resolveHlsThumbnails,
  resolveActivityCaptions,
} from './videoSource'

interface VideoDetails {
  startTime?: number
  endTime?: number | null
  autoplay?: boolean
  muted?: boolean
}

interface VideoActivityProps {
  activity: {
    activity_sub_type: string
    activity_uuid: string
    content: {
      filename?: string
      uri?: string
      description?: string
    }
    details?: VideoDetails
    extra_metadata?: {
      hls?: {
        status?: string
        width?: number
        height?: number
        thumbnails?: {
          url?: string
          interval?: number
          width?: number
          height?: number
          columns?: number
          rows?: number
        } | null
      }
      captions?: {
        enabled?: boolean
        languages?: { code?: string; label?: string; status?: string }[]
      } | null
    } | null
  }
  course: {
    course_uuid: string
  }
  orgUuid?: string
}

function VideoActivity({ activity, course, orgUuid }: VideoActivityProps) {
  const org = useOrg() as any
  const resolvedOrgUuid = orgUuid || org?.org_uuid
  const [videoId, setVideoId] = React.useState('')
  const [isLandscape, setIsLandscape] = useState(false)

  // Intrinsic aspect ratio of the hosted video: seeded from the server's HLS
  // metadata (probed at transcode time) so the layout fits portrait/square
  // videos without a shift, and refined by the player on loadedmetadata.
  const hls = activity?.extra_metadata?.hls
  const [aspectRatio, setAspectRatio] = useState<number | null>(() =>
    hls?.width && hls?.height && hls.width > 0 && hls.height > 0 ? hls.width / hls.height : null
  )
  const handleDimensions = React.useCallback((w: number, h: number) => {
    if (w > 0 && h > 0) setAspectRatio(w / h)
  }, [])

  useEffect(() => {
    const checkOrientation = () => setIsLandscape(window.innerHeight < 500 && window.innerWidth > window.innerHeight)
    checkOrientation()
    window.addEventListener('resize', checkOrientation)
    return () => window.removeEventListener('resize', checkOrientation)
  }, [])

  React.useEffect(() => {
    if (activity?.content?.uri) {
      var getYouTubeID = require('get-youtube-id')
      setVideoId(getYouTubeID(activity.content.uri))
    }
  }, [activity, org])

  // Prefer adaptive HLS once transcoding is ready; otherwise fall back to the
  // (optimized) progressive MP4 so playback always works.
  const hlsReady = isActivityHlsReady(activity)

  const getVideoSource = () =>
    resolveActivityVideoSource({
      hlsReady,
      orgUuid: resolvedOrgUuid,
      courseUuid: course?.course_uuid,
      activityUuid: activity.activity_uuid,
      filename: activity.content?.filename,
    })

  return (
    <div className="w-full max-w-full px-0 sm:px-4">
      {!isLandscape && (
        <div className="md:hidden rounded-xl p-2.5 text-center text-xs mb-3" style={{ background: 'var(--ordria-accent-bg)', color: 'var(--ordria-accent-secondary)', border: '1px solid var(--ordria-accent-border)' }}>
          📱 Pivotez pour une meilleure immersion
        </div>
      )}
      {activity && (
        <>
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_HOSTED' && (
            <div className={`my-0 sm:my-3 md:my-5 w-full overflow-hidden ${isLandscape ? 'fixed inset-0 z-[var(--z-overlay)] bg-black flex items-center justify-center' : ''}`}>
              {isLandscape ? (
                <div className="w-full h-full">
                  {(() => {
                    const { src, isHls } = getVideoSource()
                    const fallbackSrc = isHls
                      ? resolveActivityVideoSource({
                          hlsReady: false,
                          orgUuid: resolvedOrgUuid,
                          courseUuid: course?.course_uuid,
                          activityUuid: activity.activity_uuid,
                          filename: activity.content?.filename,
                        }).src
                      : undefined
                    return src ? (
                      <LearnHousePlayer
                        key={src}
                        src={src}
                        isHls={isHls}
                        fallbackSrc={fallbackSrc}
                        details={activity.details}
                        onDimensions={handleDimensions}
                      />
                    ) : null
                  })()}
                </div>
              ) : (
                <AdaptiveVideoShell
                  aspectRatio={aspectRatio}
                  maxHeightVh={75}
                  className="sm:rounded-2xl ring-0 sm:ring-1 sm:ring-gray-200/10 sm:dark:ring-gray-700/20 shadow-none"
                >
                  {(() => {
                    const { src, isHls } = getVideoSource()
                    const thumbnails = isHls
                      ? resolveHlsThumbnails(activity, {
                          orgUuid: resolvedOrgUuid,
                          courseUuid: course?.course_uuid,
                          activityUuid: activity.activity_uuid,
                        })
                      : null
                    const fallbackSrc = isHls
                      ? resolveActivityVideoSource({
                          hlsReady: false,
                          orgUuid: resolvedOrgUuid,
                          courseUuid: course?.course_uuid,
                          activityUuid: activity.activity_uuid,
                          filename: activity.content?.filename,
                        }).src
                      : undefined
                    const captions = resolveActivityCaptions(activity, {
                      orgUuid: resolvedOrgUuid,
                      courseUuid: course?.course_uuid,
                      activityUuid: activity.activity_uuid,
                    })
                    return src ? (
                      <LearnHousePlayer
                        key={src}
                        src={src}
                        isHls={isHls}
                        fallbackSrc={fallbackSrc}
                        details={activity.details}
                        thumbnails={thumbnails}
                        captions={captions}
                        onDimensions={handleDimensions}
                      />
                    ) : null
                  })()}
                </AdaptiveVideoShell>
              )}
            </div>
          )}
          {activity.activity_sub_type === 'SUBTYPE_VIDEO_YOUTUBE' && (
            <div className={`my-0 sm:my-3 md:my-5 w-full overflow-hidden ${isLandscape ? 'fixed inset-0 z-[var(--z-overlay)] bg-black flex items-center justify-center' : ''}`}>
              <div className={`${isLandscape ? 'w-full h-full' : 'relative w-full aspect-video max-h-[60vh] sm:rounded-2xl overflow-hidden ring-0 sm:ring-1 sm:ring-gray-200/10 sm:dark:ring-gray-700/20 shadow-none'}`}>
                <YouTube
                  className="w-full h-full"
                  opts={{
                    width: '100%',
                    height: '100%',
                    playerVars: {
                      autoplay: activity.details?.autoplay ? 1 : 0,
                      mute: activity.details?.muted ? 1 : 0,
                      start: activity.details?.startTime || 0,
                      end: activity.details?.endTime || undefined,
                      controls: 1,
                      modestbranding: 1,
                      rel: 0
                    },
                  }}
                  videoId={videoId}
                  onReady={(event) => {
                    if (activity.details?.startTime) {
                      event.target.seekTo(activity.details.startTime, true)
                    }
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
      {activity?.content?.description && !isLandscape && (
        <div className="mt-4 p-4 rounded-xl" style={{ background: 'var(--ordria-surface)', border: '1px solid var(--ordria-border)' }}>
          <p className="text-sm whitespace-pre-wrap leading-relaxed" style={{ color: 'var(--ordria-foreground)' }}>
            {activity.content.description}
          </p>
        </div>
      )}
    </div>
  )
}

export default VideoActivity
