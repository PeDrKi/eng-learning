import { beforeEach, describe, expect, it, vi } from 'vitest'
import { sendReminders } from '../src/jobs/sendReminders.js'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const config = (enabled = true) => ({
  push: { enabled, publicKey: 'pub', privateKey: 'priv', subject: 'mailto:a@b.test' },
})

// Bật nhắc cho 1 người: đặt giờ nhắc = đúng giờ hiện tại theo múi giờ truyền vào.
async function enableReminder(user, { tz = 'Asia/Ho_Chi_Minh', hourOffset = 0 } = {}) {
  await pool.query(
    `insert into user_settings (user_id, reminder_enabled, reminder_hour, reminder_tz)
     values ($1, true, (extract(hour from (now() at time zone $2))::int + $3 + 24) % 24, $2)
     on conflict (user_id) do update
       set reminder_enabled = true, reminder_hour = excluded.reminder_hour, reminder_tz = excluded.reminder_tz,
           reminder_sent_at = null`,
    [user.id, tz, hourOffset],
  )
}

const addSubscription = (user, endpoint = `https://push.test/${user.id}`) =>
  pool.query(
    `insert into push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, 'k', 'a')
     on conflict (endpoint) do nothing`,
    [user.id, endpoint],
  )

// Mọi từ của alice đến hạn ngay (buildWorld tạo due_at = now()), nên chỉ cần bật nhắc là đủ điều kiện.
describe('gửi nhắc học', () => {
  it('đúng giờ + chưa học hôm nay + có thẻ đến hạn → gửi, và ghi lại thời điểm gửi', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice)
    const sendOne = vi.fn().mockResolvedValue({})

    const result = await sendReminders(pool, config(), { sendOne })
    expect(result).toMatchObject({ users: 1, sent: 1, failed: 0 })
    const body = JSON.parse(sendOne.mock.calls[0][1])
    expect(body.title).toMatch(/ôn từ/)
    expect(body.body).toMatch(/thẻ đến hạn/)

    const { rows } = await pool.query('select reminder_sent_at from user_settings where user_id = $1', [w.alice.id])
    expect(rows[0].reminder_sent_at).toBeTruthy()
  })

  it('chạy lại ngay sau đó KHÔNG gửi lần hai', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice)
    const sendOne = vi.fn().mockResolvedValue({})
    await sendReminders(pool, config(), { sendOne })
    const again = await sendReminders(pool, config(), { sendOne })
    expect(again.sent).toBe(0)
    expect(sendOne).toHaveBeenCalledTimes(1)
  })

  it('chưa tới giờ của người đó thì không gửi', async () => {
    await enableReminder(w.alice, { hourOffset: 3 })
    await addSubscription(w.alice)
    const sendOne = vi.fn().mockResolvedValue({})
    expect((await sendReminders(pool, config(), { sendOne })).sent).toBe(0)
  })

  it('hôm nay đã ôn rồi thì không nhắc nữa', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice)
    await pool.query('insert into review_log (user_id, word_id, quality) values ($1, $2, 2)', [
      w.alice.id,
      w.words.alicePersonal.id,
    ])
    const sendOne = vi.fn().mockResolvedValue({})
    expect((await sendReminders(pool, config(), { sendOne })).sent).toBe(0)
  })

  it('không còn thẻ nào đến hạn thì không nhắc', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice)
    await pool.query("update word_progress set due_at = now() + interval '5 days' where user_id = $1", [w.alice.id])
    const sendOne = vi.fn().mockResolvedValue({})
    const result = await sendReminders(pool, config(), { sendOne })
    expect(result.sent).toBe(0)
    expect(result.skippedNothingDue).toBe(1)
  })

  it('chưa bật nhắc thì không gửi', async () => {
    await addSubscription(w.alice)
    const sendOne = vi.fn().mockResolvedValue({})
    expect((await sendReminders(pool, config(), { sendOne })).sent).toBe(0)
  })

  it('đăng ký đã chết (410) bị xoá; lỗi mạng tạm thời thì giữ lại để lần sau thử tiếp', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice, 'https://push.test/chet')
    await addSubscription(w.alice, 'https://push.test/mang-loi')
    const sendOne = vi.fn(async (sub) => {
      if (sub.endpoint.endsWith('chet')) throw Object.assign(new Error('gone'), { statusCode: 410 })
      throw Object.assign(new Error('timeout'), { statusCode: 500 })
    })

    const result = await sendReminders(pool, config(), { sendOne })
    expect(result).toMatchObject({ sent: 0, failed: 2, removed: 1, users: 0 })
    const { rows } = await pool.query('select endpoint from push_subscriptions where user_id = $1', [w.alice.id])
    expect(rows.map((r) => r.endpoint)).toEqual(['https://push.test/mang-loi'])
  })

  it('không gửi được cho ai thì KHÔNG đánh dấu đã nhắc (lần chạy sau còn thử lại)', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice)
    const sendOne = vi.fn().mockRejectedValue(Object.assign(new Error('down'), { statusCode: 500 }))
    await sendReminders(pool, config(), { sendOne })
    const { rows } = await pool.query('select reminder_sent_at from user_settings where user_id = $1', [w.alice.id])
    expect(rows[0].reminder_sent_at).toBeNull()
  })

  it('máy chủ chưa cấu hình khoá VAPID → bỏ qua, không đụng tới database', async () => {
    await enableReminder(w.alice)
    await addSubscription(w.alice)
    expect(await sendReminders(pool, config(false), {})).toEqual({ skipped: 'push_not_configured' })
  })
})
