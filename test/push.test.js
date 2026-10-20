import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

// Thay `web-push` bằng bản giả: test đi qua ĐÚNG đường mà lời nhắc thật đi (route → deliver.js →
// web-push), chỉ chặn lại ở bước duy nhất cần internet và dịch vụ push của trình duyệt.
const sendNotification = vi.fn()
vi.mock('web-push', () => ({ default: { sendNotification: (...args) => sendNotification(...args) } }))

// Bật sẵn khoá VAPID để test được đường đăng ký thật. Nhánh "chưa cấu hình" có test riêng ở
// test/reminders.test.js.
const { app, pool } = setupTestApp({
  VAPID_PUBLIC_KEY: 'khoa-cong-khai-gia-de-test',
  VAPID_PRIVATE_KEY: 'khoa-bi-mat-gia-de-test',
})
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
  sendNotification.mockReset()
  sendNotification.mockResolvedValue({ statusCode: 201 })
})

const SUB = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
  keys: { p256dh: 'khoa-p256dh', auth: 'khoa-auth' },
}

describe('/push', () => {
  it('trả khoá công khai + cờ bật/tắt để FE biết có hiện nút nhắc học không', async () => {
    const res = await w.alice.get('/push/public-key')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ enabled: true, public_key: 'khoa-cong-khai-gia-de-test' })
  })

  it('chưa đăng nhập thì không gọi được', async () => {
    const request = (await import('supertest')).default
    expect((await request(app).get('/push/public-key')).status).toBe(401)
    expect((await request(app).post('/push/subscribe').send(SUB)).status).toBe(401)
  })

  it('đăng ký lại trên cùng thiết bị không tạo dòng rác, và đổi tài khoản thì chuyển chủ', async () => {
    expect((await w.alice.post('/push/subscribe', SUB)).status).toBe(201)
    expect((await w.alice.post('/push/subscribe', { ...SUB, keys: { p256dh: 'moi', auth: 'moi' } })).status).toBe(201)
    let rows = (await pool.query('select user_id, p256dh from push_subscriptions where endpoint = $1', [SUB.endpoint]))
      .rows
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_id: w.alice.id, p256dh: 'moi' })

    // Người khác dùng chung máy: đăng ký chuyển sang họ, không nhân đôi.
    expect((await w.bob.post('/push/subscribe', SUB)).status).toBe(201)
    rows = (await pool.query('select user_id from push_subscriptions where endpoint = $1', [SUB.endpoint])).rows
    expect(rows).toHaveLength(1)
    expect(rows[0].user_id).toBe(w.bob.id)
  })

  it('dữ liệu đăng ký sai định dạng bị từ chối', async () => {
    expect((await w.alice.post('/push/subscribe', { endpoint: 'khong-phai-url', keys: SUB.keys })).status).toBe(400)
    expect((await w.alice.post('/push/subscribe', { endpoint: SUB.endpoint })).status).toBe(400)
    // Chống SSRF: chỉ nhận HTTPS của dịch vụ đẩy thật, không nhận địa chỉ nội bộ/lạ.
    for (const endpoint of [
      'http://fcm.googleapis.com/fcm/send/x',
      'https://169.254.169.254/latest/meta-data',
      'https://eng-learning.internal/x',
      'https://fcm.googleapis.com.evil.com/x',
      'https://evilfcm.googleapis.com.attacker.net/x',
      'https://fcm.googleapis.com:8443/x',
    ]) {
      expect((await w.alice.post('/push/subscribe', { endpoint, keys: SUB.keys })).status, endpoint).toBe(400)
    }
    for (const endpoint of [
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/QK1',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      expect((await w.alice.post('/push/subscribe', { endpoint, keys: SUB.keys })).status, endpoint).toBe(201)
    }
  })

  it('huỷ đăng ký chỉ xoá đúng thiết bị của mình; huỷ cái không tồn tại vẫn 204', async () => {
    await w.alice.post('/push/subscribe', SUB)
    await w.bob.post('/push/subscribe', { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/cua-bob' })

    expect(
      (await w.alice.post('/push/unsubscribe', { endpoint: 'https://fcm.googleapis.com/fcm/send/cua-bob' })).status,
    ).toBe(204)
    expect((await pool.query('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(2) // không xoá được của người khác

    expect((await w.alice.post('/push/unsubscribe', { endpoint: SUB.endpoint })).status).toBe(204)
    expect((await w.alice.post('/push/unsubscribe', { endpoint: SUB.endpoint })).status).toBe(204)
    const { rows } = await pool.query('select user_id from push_subscriptions')
    expect(rows.map((r) => r.user_id)).toEqual([w.bob.id])
  })

  it('xoá tài khoản thì xoá luôn đăng ký nhận nhắc', async () => {
    await w.alice.post('/push/subscribe', SUB)
    await pool.query('delete from users where id = $1', [w.alice.id])
    expect((await pool.query('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(0)
  })
})

// "Gửi thử" là cách duy nhất để người dùng biết nhắc học có chạy được trên máy họ hay không mà
// không phải đợi tới giờ. Nên nó phải gửi THẬT, và phải báo thật khi không gửi được.
describe('/push/test — gửi thử', () => {
  it('gửi tới mọi thiết bị đã đăng ký của mình, và chỉ của mình', async () => {
    await w.alice.post('/push/subscribe', SUB)
    await w.alice.post('/push/subscribe', { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/may-tinh' })
    await w.bob.post('/push/subscribe', { ...SUB, endpoint: 'https://fcm.googleapis.com/fcm/send/cua-bob' })

    const res = await w.alice.post('/push/test', {})
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ sent: 2, failed: 0, removed: 0 })
    expect(sendNotification).toHaveBeenCalledTimes(2)
    const endpoints = sendNotification.mock.calls.map((c) => c[0].endpoint).toSorted()
    expect(endpoints).toEqual([
      'https://fcm.googleapis.com/fcm/send/abc123',
      'https://fcm.googleapis.com/fcm/send/may-tinh',
    ])
  })

  it('nội dung nói rõ đây là thông báo thử', async () => {
    await w.alice.post('/push/subscribe', SUB)
    await w.alice.post('/push/test', {})
    const payload = JSON.parse(sendNotification.mock.calls[0][1])
    expect(payload.test).toBe(true)
    expect(payload.title).toMatch(/thử/i)
    expect(payload.body).toBeTruthy()
  })

  it('chưa đăng ký trên máy nào → 409 chứ không phải "ok" rồi im lặng', async () => {
    const res = await w.alice.post('/push/test', {})
    expect(res.status).toBe(409)
    expect(res.body.error.code).toBe('no_active_subscription')
    expect(sendNotification).not.toHaveBeenCalled()
  })

  it('đăng ký đã chết (410) → xoá khỏi database và báo không gửi được', async () => {
    await w.alice.post('/push/subscribe', SUB)
    sendNotification.mockRejectedValue(Object.assign(new Error('Gone'), { statusCode: 410 }))
    const res = await w.alice.post('/push/test', {})
    expect(res.status).toBe(409)
    expect((await pool.query('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(0)
  })

  it('lỗi tạm thời (5xx của dịch vụ push) → GIỮ đăng ký để lần sau thử tiếp', async () => {
    await w.alice.post('/push/subscribe', SUB)
    sendNotification.mockRejectedValue(Object.assign(new Error('Service Unavailable'), { statusCode: 503 }))
    expect((await w.alice.post('/push/test', {})).status).toBe(409)
    expect((await pool.query('select count(*)::int as n from push_subscriptions')).rows[0].n).toBe(1)
  })

  it('chưa đăng nhập thì không gọi được', async () => {
    const request = (await import('supertest')).default
    expect((await request(app).post('/push/test').send({})).status).toBe(401)
  })
})

describe('/settings — nhắc học', () => {
  it('mặc định: tắt, 20h, múi giờ Việt Nam', async () => {
    const { body } = await w.alice.get('/settings')
    expect(body).toMatchObject({ reminder_enabled: false, reminder_hour: 20, reminder_tz: 'Asia/Ho_Chi_Minh' })
  })

  it('bật nhắc và chọn giờ + múi giờ; giá trị vô lý bị từ chối', async () => {
    const ok = await w.alice.put('/settings', { reminder_enabled: true, reminder_hour: 7, reminder_tz: 'Europe/Paris' })
    expect(ok.status).toBe(200)
    expect(ok.body).toMatchObject({ reminder_enabled: true, reminder_hour: 7, reminder_tz: 'Europe/Paris' })
    // Các cài đặt học khác không bị đụng tới.
    expect(ok.body.daily_goal).toBe(20)

    expect((await w.alice.put('/settings', { reminder_hour: 24 })).status).toBe(400)
    expect((await w.alice.put('/settings', { reminder_tz: 'Khong/Co_That' })).status).toBe(400)
  })
})
