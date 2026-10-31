import { beforeEach, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

// COMMUNITY_REQUIRE_VERIFIED_EMAIL=true: chỉ tài khoản đã xác nhận email mới nhận xét được.
const { app, pool } = setupTestApp({ COMMUNITY_REQUIRE_VERIFIED_EMAIL: 'true' })
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
  await w.bob.put(`/community/decks/${w.decks.bob.id}/publish`, {})
})

it('chưa xác nhận email → 403 email_not_verified; xác nhận rồi thì nhận xét được', async () => {
  const post = () => w.carol.post(`/community/decks/${w.decks.bob.id}/comments`, { body: 'Hay' })
  const res = await post()
  expect(res.status).toBe(403)
  expect(res.body.error.code).toBe('email_not_verified')
  await pool.query('update users set email_verified_at = now() where id = $1', [w.carol.id])
  expect((await post()).status).toBe(201)
})
