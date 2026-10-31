import { beforeEach, expect, it, vi } from 'vitest'
import { createNotifier } from '../src/modules/community/notify.js'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

it('Web Push được gom: nhiều thông báo liền nhau chỉ đẩy 1 lần / 15 phút; người chưa bật nhắc thì không đẩy', async () => {
  await pool.query(
    "insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, 'https://push.example/1', 'k', 'a')",
    [w.bob.id],
  )
  const send = vi.fn().mockResolvedValue()
  const notify = createNotifier({ pool, send, log: () => {} })
  const note = { type: 'comment', deckId: w.decks.bob.id, actorId: w.carol.id, payload: { deck_name: 'Bob riêng' } }
  await notify(w.bob.id, note)
  await notify(w.bob.id, note)
  await notify(w.alice.id, { ...note, deckId: w.decks.alice.id }) // Alice chưa bật nhắc → không có thiết bị
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1))
  const payload = JSON.parse(send.mock.calls[0][1])
  expect(payload).toMatchObject({ title: 'Nhận xét mới', url: `/explore?deck=${w.decks.bob.id}` })

  const { rows } = await pool.query('select user_id from notifications order by created_at')
  expect(rows).toHaveLength(3) // thông báo trong app thì vẫn ghi đủ
})

it('không tự thông báo cho chính người hành động; lỗi ghi không làm hỏng thao tác chính', async () => {
  const log = vi.fn()
  const notify = createNotifier({ pool, send: null, log })
  await notify(w.bob.id, { type: 'comment', deckId: w.decks.bob.id, actorId: w.bob.id })
  await notify(w.bob.id, { type: 'loại-lạ', deckId: w.decks.bob.id, actorId: w.carol.id })
  const { rows } = await pool.query('select count(*)::int as n from notifications')
  expect(rows[0].n).toBe(0)
  expect(log).toHaveBeenCalled()
})
