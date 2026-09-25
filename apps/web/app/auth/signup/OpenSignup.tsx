'use client'
import { useFormik } from 'formik'
import { useRouter } from 'next/navigation'
import React, { useEffect } from 'react'
import FormLayout, {
  FormField,
} from '@components/Objects/StyledElements/Form/Form'
import * as Form from '@radix-ui/react-form'
import { AlertTriangle, Info, Mail, User } from 'lucide-react'
import Link from 'next/link'
import { signup, resendVerificationEmail } from '@services/auth/auth'
import { useOrg } from '@components/Contexts/OrgContext'
import { signIn } from '@components/Contexts/AuthContext'
import { getLEARNHOUSE_TOP_DOMAIN_VAL, isOnCustomDomain } from '@services/config/config'
import { getErrorMessage } from '@services/utils/ts/errorMessage'
import { useTranslation } from 'react-i18next'
import { PasswordStrengthIndicator, validatePasswordStrength } from '@components/Auth/PasswordStrengthIndicator'
import TurnstileWidget, { useTurnstileRequired, type TurnstileWidgetHandle } from '@components/Auth/TurnstileWidget'
import { getPublicJobTitles, type JobTitle } from '@services/users/jobTitles'
import { useLHAnalytics, AnalyticsEvent } from '@services/analytics'

const validate = (values: any, t: any) => {
  const errors: any = {}

  if (!values.email) {
    errors.email = t('validation.required')
  } else if (!/^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(values.email)) {
    errors.email = t('validation.invalid_email')
  }

  if (!values.password) {
    errors.password = t('validation.required')
  } else {
    const passwordValidation = validatePasswordStrength(values.password)
    if (!passwordValidation.isValid) {
      errors.password = t('auth.password_requirements_not_met')
    }
  }

  if (!values.username) {
    errors.username = t('validation.required')
  } else if (values.username.length < 4) {
    errors.username = t('validation.username_min_length')
  }

  // Bio is optional - no validation required

  if (!values.jobTitleId) {
    errors.jobTitleId = t('signup.job_required', { defaultValue: 'Veuillez choisir votre métier' })
  }
  if (values.jobTitleId === 'other' && !values.jobOther?.trim()) {
    errors.jobOther = t('validation.required', { defaultValue: 'Requis' })
  }
  if (values.phone && !/^\+?[0-9 .()-]{6,20}$/.test(values.phone.trim())) {
    errors.phone = t('signup.invalid_phone', { defaultValue: 'Numéro invalide' })
  }
  if (!values.consentTerms || !values.consentPrivacy) {
    errors.consentTerms = t('signup.consent_required', { defaultValue: 'Vous devez accepter pour continuer' })
  }

  return errors
}

interface OpenSignUpComponentProps {
  // On the org-less apex the OrgContext is empty, so the signup page resolves
  // the instance default org server-side and passes it down here. Prefer it over
  // the (possibly null) context so the POST always targets a real org_id.
  org?: any
}

function OpenSignUpComponent({ org: propOrg }: OpenSignUpComponentProps = {}) {
  const { t } = useTranslation()
  const { track } = useLHAnalytics('public')
  const [isSubmitting, setIsSubmitting] = React.useState(false)
  const contextOrg = useOrg() as any
  const org = (contextOrg && (contextOrg.id || contextOrg.slug)) ? contextOrg : propOrg
  const _router = useRouter()
  const [error, setError] = React.useState('')
  const [message, setMessage] = React.useState<{ email_verified: boolean } | null>(null)
  const [resendState, setResendState] = React.useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const turnstileRef = React.useRef<TurnstileWidgetHandle>(null)
  const turnstileRequired = useTurnstileRequired()
  const [jobTitles, setJobTitles] = React.useState<JobTitle[]>([])

  React.useEffect(() => {
    let cancelled = false
    getPublicJobTitles().then((titles) => {
      if (!cancelled) setJobTitles(titles)
    })
    return () => {
      cancelled = true
    }
  }, [])
  const formik = useFormik({
    initialValues: {
      org_slug: org?.slug,
      org_id: org?.id,
      email: '',
      password: '',
      username: '',
      bio: '',
      first_name: '',
      last_name: '',
      turnstileToken: null as string | null,
      jobTitleId: '' as string | '',
      jobOther: '',
      phone: '',
      consentTerms: false,
      consentPrivacy: false,
    },
    validate: (values) => validate(values, t),
    enableReinitialize: true,
    onSubmit: async (values) => {
      setError('')
      setMessage(null)
      setIsSubmitting(true)
      track(AnalyticsEvent.SignupSubmitted, { invite_code_present: false, has_bio: !!values.bio })
      try {
        const selectedJob = jobTitles.find((j) => String(j.id) === values.jobTitleId)
        const profile: Record<string, unknown> = {
          job: selectedJob
            ? { title_id: selectedJob.id, slug: selectedJob.slug, label: selectedJob.label, other: null }
            : { title_id: null, slug: 'other', other: values.jobOther?.trim() || null },
        }
        if (values.phone?.trim()) {
          profile['phone'] = values.phone.trim()
        }
        const payload = {
          ...values,
          profile,
          extra_metadata: { consents: { terms: true, privacy: true } },
        }
        let res = await signup(payload)
        let message = await res.json().catch(() => ({}))
        if (res.status == 200) {
          track(AnalyticsEvent.SignupSucceeded, { email_verified: message.email_verified })
          setMessage(message)
        } else {
          // Surface the backend's actual error detail for ANY non-2xx (incl. 409
          // already-exists, 422 validation, 503 email-service-down) instead of
          // masking everything past the handful of hardcoded statuses behind a
          // generic message. Fall back to a generic string only when the backend
          // gave us nothing readable.
          track(AnalyticsEvent.SignupFailed, { status_code: res.status })
          setError(getErrorMessage(message?.detail, t('common.something_went_wrong')))
          // Turnstile tokens are single-use — fetch a fresh one for the retry.
          turnstileRef.current?.reset()
        }
      } catch (err) {
        // A network throw must not leave the form permanently locked.
        setError(getErrorMessage((err as any)?.detail, t('common.something_went_wrong')))
        turnstileRef.current?.reset()
      } finally {
        setIsSubmitting(false)
      }
    },
  })

  useEffect(() => { }, [org])

  // Honor a sanitized ?next / ?redirect destination through the
  // cross-domain /redirect_from_auth handoff; default to /home.
  const buildCallbackUrl = () => {
    const params = new URLSearchParams(window.location.search)
    const raw = params.get('next') ?? params.get('redirect')
    const dest = raw && /^\/(?!\/)/.test(raw) ? raw : '/home'
    return `${window.location.origin}/redirect_from_auth?next=${encodeURIComponent(dest)}`
  }

  const handleGoogleSignIn = () => {
    track(AnalyticsEvent.SignupGoogleClicked)
    // Store org context in cookies before OAuth redirect
    if (org?.slug) {
      const topDomain = getLEARNHOUSE_TOP_DOMAIN_VAL();
      const isSecure = window.location.protocol === 'https:';
      const secureAttr = isSecure ? '; secure' : '';
      const baseAttributes = `; path=/; SameSite=Lax${secureAttr}`;
      // Host-only on custom domains (a .{platformTopDomain} cookie can't be set
      // from learn.acme.org → browser drops it → callback loses org context).
      const domainAttr = (topDomain === 'localhost' || isOnCustomDomain()) ? '' : `; domain=.${topDomain}`;
      document.cookie = `LH_oauth_orgslug=${org.slug}${baseAttributes}${domainAttr}`;
      document.cookie = `LH_oauth_org_id=${org.id}${baseAttributes}${domainAttr}`;
    }
    // Use absolute URL with current origin for custom domain support
    signIn('google', { callbackUrl: buildCallbackUrl() });
  };

  return (
    <div className="w-full max-w-[420px] py-10">
      {/* Header */}
      <h1 className="text-[28px] md:text-[32px] font-black text-[var(--ordria-foreground)] tracking-tight leading-tight" style={{ fontFamily: "var(--ordria-font-display, Sora)" }}>{t('auth.create_account')}</h1>
      <p className="mt-2 text-[var(--ordria-muted)] text-[15px] font-medium">{t('auth.fill_in_details')}</p>

      <div className="mt-8">
        {/* Error/Success Messages */}
        {error && (
          <div className="flex justify-center bg-red-50 rounded-xl text-red-600 space-x-2 items-center p-4 mb-6 border border-red-100">
            <AlertTriangle size={18} className="shrink-0" />
            <div className="font-medium text-sm">{error}</div>
          </div>
        )}

        {message && message.email_verified === false && (
          <div className="flex flex-col gap-4 bg-green-50 rounded-xl text-green-700 p-4 mb-6 border border-green-100">
            <div className="flex items-center gap-2">
              <Mail size={18} />
              <div className="font-semibold text-sm">{t('auth.check_email_for_verification')}</div>
            </div>
            <p className="text-xs text-green-600">
              {t('auth.verification_email_sent_message')}
            </p>
            {/* Resend, so a user whose email doesn't arrive isn't stuck. */}
            {resendState === 'sent' ? (
              <p className="text-xs font-medium text-green-700">
                {t('auth.verification_email_resent', { defaultValue: 'Verification email sent again, check your inbox.' })}
              </p>
            ) : (
              <button
                type="button"
                disabled={resendState === 'sending'}
                onClick={async () => {
                  setResendState('sending')
                  // org?.id is undefined on the org-less apex — that's fine, the
                  // backend resends by email without an org.
                  const res = await resendVerificationEmail(formik.values.email, org?.id)
                  setResendState(res.success ? 'sent' : 'error')
                }}
                className="text-xs font-semibold text-green-800 hover:underline disabled:opacity-50 text-left w-fit"
              >
                {resendState === 'sending'
                  ? t('common.loading', { defaultValue: 'Sending…' })
                  : t('auth.resend_verification', { defaultValue: "Didn't get it? Resend email" })}
              </button>
            )}
            {resendState === 'error' && (
              <p className="text-xs text-red-500">{t('auth.resend_verification_failed', { defaultValue: 'Could not resend. Please try again shortly.' })}</p>
            )}
            <hr className="border-green-100" />
            <Link className="flex items-center gap-2 text-sm font-medium hover:underline" href="/login">
              <User size={14} />
              <span>{t('auth.login')}</span>
            </Link>
          </div>
        )}

        {message && message.email_verified && (
          <div className="flex flex-col gap-4 bg-green-50 rounded-xl text-green-700 p-4 mb-6 border border-green-100">
            <div className="flex items-center gap-2">
              <Mail size={18} />
              <div className="font-semibold text-sm">{t('auth.account_created_success')}</div>
            </div>
            <hr className="border-green-100" />
            <Link className="flex items-center gap-2 text-sm font-medium hover:underline" href="/login">
              <User size={14} />
              <span>{t('auth.login')}</span>
            </Link>
          </div>
        )}

        <FormLayout onSubmit={formik.handleSubmit}>
          <FormField name="email">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">{t('auth.email')}</Form.Label>
              {formik.touched.email && formik.errors.email && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.email}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.email}
                type="email"
                required
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
              />
            </Form.Control>
          </FormField>

          <div className="flex flex-row space-x-2">
            <FormField name="first_name">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">{t('user.first_name')}</Form.Label>
                {formik.touched.first_name && formik.errors.first_name && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{formik.errors.first_name}</span>
                  </span>
                )}
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.first_name}
                  type="text"
                  className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
                />
              </Form.Control>
            </FormField>
            <FormField name="last_name">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">{t('user.last_name')}</Form.Label>
                {formik.touched.last_name && formik.errors.last_name && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{formik.errors.last_name}</span>
                  </span>
                )}
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.last_name}
                  type="text"
                  className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
                />
              </Form.Control>
            </FormField>
          </div>

          <FormField name="password">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">{t('auth.password')}</Form.Label>
              {formik.touched.password && formik.errors.password && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.password}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.password}
                type="password"
                autoComplete="new-password"
                required
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
              />
            </Form.Control>
            <PasswordStrengthIndicator password={formik.values.password} />
          </FormField>

          <FormField name="username">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">{t('user.username')}</Form.Label>
              {formik.touched.username && formik.errors.username && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.username}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.username}
                type="text"
                required
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
              />
            </Form.Control>
          </FormField>

          <FormField name="jobTitleId">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                {t('signup.job_label', { defaultValue: 'Votre métier' })}
              </Form.Label>
              {formik.touched.jobTitleId && formik.errors.jobTitleId && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.jobTitleId}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <select
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.jobTitleId}
                required
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all text-sm"
              >
                <option value="">{t('signup.job_choose', { defaultValue: 'Choisir…' })}</option>
                {jobTitles.map((j) => (
                  <option key={j.id} value={String(j.id)}>{j.label}</option>
                ))}
                <option value="other">{t('signup.job_other', { defaultValue: 'Autre' })}</option>
              </select>
            </Form.Control>
          </FormField>

          {formik.values.jobTitleId === 'other' && (
            <FormField name="jobOther">
              <div className="flex items-center space-x-2 mb-1.5">
                <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                  {t('signup.job_other_precise', { defaultValue: 'Précisez votre métier' })}
                </Form.Label>
                {formik.touched.jobOther && formik.errors.jobOther && (
                  <span className="text-red-500 text-xs flex items-center space-x-1">
                    <Info size={11} />
                    <span>{formik.errors.jobOther}</span>
                  </span>
                )}
              </div>
              <Form.Control asChild>
                <input
                  onChange={formik.handleChange}
                  onBlur={formik.handleBlur}
                  value={formik.values.jobOther}
                  type="text"
                  maxLength={100}
                  className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
                />
              </Form.Control>
            </FormField>
          )}

          <FormField name="phone">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">
                {`${t('signup.phone_label', { defaultValue: 'Téléphone' })} (${t('common.optional', { defaultValue: 'facultatif' })})`}
              </Form.Label>
              {formik.touched.phone && formik.errors.phone && (
                <span className="text-red-500 text-xs flex items-center space-x-1">
                  <Info size={11} />
                  <span>{formik.errors.phone}</span>
                </span>
              )}
            </div>
            <Form.Control asChild>
              <input
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.phone}
                type="tel"
                autoComplete="tel"
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 border border-[var(--ordria-border)] inline-flex h-[44px] appearance-none items-center focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm"
              />
            </Form.Control>
          </FormField>

          <div className="space-y-2 my-2">
            <label className="flex items-start gap-2 text-xs text-[var(--ordria-muted)]">
              <input
                type="checkbox"
                checked={formik.values.consentTerms}
                onChange={formik.handleChange}
                name="consentTerms"
                className="mt-0.5 accent-[var(--ordria-accent)]"
              />
              <span>
                {t('signup.consent_terms', { defaultValue: "J'accepte les" })}{' '}
                <a href="https://ordria.fr/cgv" target="_blank" rel="noopener noreferrer" className="underline font-medium text-[var(--ordria-foreground)]">
                  {t('signup.consent_terms_link', { defaultValue: 'conditions générales' })}
                </a>
              </span>
            </label>
            <label className="flex items-start gap-2 text-xs text-[var(--ordria-muted)]">
              <input
                type="checkbox"
                checked={formik.values.consentPrivacy}
                onChange={formik.handleChange}
                name="consentPrivacy"
                className="mt-0.5 accent-[var(--ordria-accent)]"
              />
              <span>
                {t('signup.consent_privacy', { defaultValue: "J'accepte la" })}{' '}
                <a href="https://ordria.fr/mentions-legales" target="_blank" rel="noopener noreferrer" className="underline font-medium text-[var(--ordria-foreground)]">
                  {t('signup.consent_privacy_link', { defaultValue: 'politique de confidentialité' })}
                </a>
              </span>
            </label>
            {formik.touched.consentTerms && formik.errors.consentTerms && (
              <p className="text-red-500 text-xs">{formik.errors.consentTerms}</p>
            )}
          </div>

          <FormField name="bio">
            <div className="flex items-center space-x-2 mb-1.5">
              <Form.Label className="grow text-[13px] font-semibold text-[var(--ordria-foreground)]/70">{`${t('user.bio')} (${t('common.optional')})`}</Form.Label>
            </div>
            <Form.Control asChild>
              <textarea
                onChange={formik.handleChange}
                onBlur={formik.handleBlur}
                value={formik.values.bio}
                placeholder={t('user.bio_placeholder')}
                className="box-border w-full bg-white text-[var(--ordria-foreground)] rounded-lg px-4 py-3 border border-[var(--ordria-border)] appearance-none focus:outline-none focus:ring-2 focus:ring-[oklch(0.80_0.13_213/0.3)] focus:border-[var(--ordria-accent)] transition-all placeholder:text-[var(--ordria-muted)] text-sm resize-none min-h-[80px]"
              />
            </Form.Control>
          </FormField>

          <TurnstileWidget
            ref={turnstileRef}
            onToken={(token) => formik.setFieldValue('turnstileToken', token)}
            className="mt-2 flex justify-center"
          />

          <Form.Submit asChild>
            <button
              disabled={isSubmitting || !!message || (turnstileRequired && !formik.values.turnstileToken) || !formik.values.jobTitleId || !formik.values.consentTerms || !formik.values.consentPrivacy}
              className="box-border w-full inline-flex h-[44px] rounded-lg items-center justify-center bg-[var(--ordria-accent)] hover:bg-[var(--ordria-accent-hover)] text-[var(--ordria-nuit)] px-[15px] font-bold text-[14px] leading-none mt-2 transition-all disabled:opacity-50"
            >
              {isSubmitting ? (
                <span className="flex items-center space-x-2">
                  <span className="w-4 h-4 border-t-2 border-white rounded-full animate-spin" />
                  <span>{t('common.loading')}</span>
                </span>
              ) : (
                t('auth.create_account')
              )}
            </button>
          </Form.Submit>
        </FormLayout>

        {/* Divider */}
        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-[var(--ordria-border)]" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-3 text-[var(--ordria-muted)] bg-white text-xs font-medium">{t('common.or')}</span>
          </div>
        </div>

        {/* Google Sign In */}
        <button
          onClick={handleGoogleSignIn}
          disabled={isSubmitting}
          className="flex justify-center items-center w-full bg-white hover:bg-[var(--ordria-surface)] text-[var(--ordria-foreground)] space-x-3 font-medium p-3 rounded-lg border border-[var(--ordria-border)] transition-all text-sm disabled:opacity-50"
        >
          <img src="https://fonts.gstatic.com/s/i/productlogos/googleg/v6/24px.svg" alt="" className="w-4 h-4" />
          <span>{t('auth.sign_in_with_google')}</span>
        </button>

        {/* Login Link */}
        <p className="text-center text-sm text-[var(--ordria-muted)] mt-6">
          {t('auth.already_have_account')}{' '}
          <Link href="/login" className="text-[var(--ordria-foreground)] font-semibold hover:underline">
            {t('auth.login')}
          </Link>
        </p>
      </div>
    </div>
  )
}

export default OpenSignUpComponent
