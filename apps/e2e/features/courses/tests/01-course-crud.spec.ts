/**
 * E2E: Course CRUD lifecycle.
 *
 * Each test creates its own throwaway course so mutations never leak:
 *  - a course can be created and read back by uuid
 *  - metadata (name, description, about, tags) can be updated and read back
 *  - visibility flags (public/published) can be toggled
 *  - a course can be deleted and then 404s on read
 */
import { test, expect } from '../../../core/fixtures'
import { adminToken } from '../scenario'
import * as api from '../api'

test.beforeAll(async () => {
  await adminToken()
})

test.describe('Course CRUD', () => {
  test('a course can be created and read back by uuid', async () => {
    const token = await adminToken()
    const name = `E2E Crud Course ${Date.now().toString(36)}`
    const org = await api.getOrg()
    const created = await api.createCourse(token, org.id, name)
    expect(created.id).toBeGreaterThan(0)
    expect(created.course_uuid).toMatch(/^course_/)

    const read = await api.getCourse(token, created.course_uuid)
    expect(read.name).toBe(name)
    expect(read.course_uuid).toBe(created.course_uuid)

    await api.deleteCourse(token, created.course_uuid).catch(() => {})
  })

  test('course metadata can be updated and read back', async () => {
    const token = await adminToken()
    const org = await api.getOrg()
    const suffix = Date.now().toString(36)
    const created = await api.createCourse(token, org.id, `E2E Meta Course ${suffix}`)

    const updated = await api.updateCourse(token, created.course_uuid, {
      name: `E2E Meta Course ${suffix} v2`,
      description: `Updated description ${suffix}`,
      about: 'Updated about text',
      tags: 'e2e,updated',
    })
    expect(updated.name).toBe(`E2E Meta Course ${suffix} v2`)

    const read = await api.getCourse(token, created.course_uuid)
    expect(read.name).toBe(`E2E Meta Course ${suffix} v2`)
    expect(read.description).toBe(`Updated description ${suffix}`)
    expect(read.tags).toBe('e2e,updated')

    await api.deleteCourse(token, created.course_uuid).catch(() => {})
  })

  test('course visibility flags can be toggled', async () => {
    const token = await adminToken()
    const org = await api.getOrg()
    const created = await api.createCourse(token, org.id, `E2E Vis Course ${Date.now().toString(36)}`)

    const unpublished = await api.updateCourse(token, created.course_uuid, {
      public: false,
      published: false,
    })
    expect(unpublished.public).toBe(false)
    expect(unpublished.published).toBe(false)

    const republished = await api.updateCourse(token, created.course_uuid, {
      public: true,
      published: true,
    })
    expect(republished.public).toBe(true)
    expect(republished.published).toBe(true)

    await api.deleteCourse(token, created.course_uuid).catch(() => {})
  })

  test('a deleted course is gone', async () => {
    const token = await adminToken()
    const org = await api.getOrg()
    const created = await api.createCourse(token, org.id, `E2E Gone Course ${Date.now().toString(36)}`)

    await api.deleteCourse(token, created.course_uuid)

    const meta = await api.tryGetCourseMeta(token, created.course_uuid)
    expect(meta).toBeNull()
  })
})
