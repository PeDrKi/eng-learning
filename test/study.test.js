import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

describe('GET /progress', () => {
  it('chỉ trả tiến trình của CHÍNH MÌNH — kể cả trưởng nhóm cũng không nhận dòng của thành viên', async () => {
    // Bản Supabase: RLS cho trưởng nhóm SELECT được word_progress của thành viên (phục vụ
    // dashboard), nên listMyProgress() của trưởng nhóm lẫn cả dòng của người khác.
    const alice = (await w.alice.get('/progress')).body
    expect(alice.every((p) => p.user_id === w.alice.id)).toBe(true)
    expect(alice.map((p) => p.word_id).toSorted()).toEqual(
      [w.words.alicePersonal.id, w.words.aliceInGroup.id].toSorted(),
    )

    const bob = (await w.bob.get('/progress')).body
    expect(bob.map((p) => p.word_id).toSorted()).toEqual(
      [w.words.bobPersonal.id, w.words.bobInGroup.id, w.words.bobUncategorized.id].toSorted(),
    )
  })

  it('dòng mặc định do trigger tạo có đủ giá trị ban đầu', async () => {
    const [row] = (await w.carol.get('/progress')).body
    expect(row).toMatchObject({ ease_factor: 2.5, interval_days: 0, repetitions: 0, quiz_correct: 0, quiz_wrong: 0 })
    expect(row.last_reviewed_at).toBeNull()
  })
})

describe('PATCH /progress/:wordId', () => {
  it('chỉ đổi các field gửi lên, giữ nguyên phần còn lại', async () => {
    const res = await w.bob.patch(`/progress/${w.words.bobPersonal.id}`, {
      ease_factor: 2.36,
      interval_days: 6,
      repetitions: 2,
      due_at: '2026-10-03T08:00:00.000Z',
      last_reviewed_at: '2026-09-27T08:00:00+07:00',
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({
      user_id: w.bob.id,
      ease_factor: 2.36,
      interval_days: 6,
      repetitions: 2,
      due_at: '2026-10-03T08:00:00.000Z',
      last_reviewed_at: '2026-09-27T01:00:00.000Z', // múi giờ +07:00 được quy đổi đúng
      ease_factor_rev: 2.5, // chiều Việt→Anh không bị đụng tới
      quiz_correct: 0,
    })
  })

  it('từ người khác thêm vào chủ đề nhóm: tạo dòng tiến trình RIÊNG cho mình khi học lần đầu', async () => {
    const res = await w.bob.patch(`/progress/${w.words.aliceInGroup.id}`, { quiz_correct: 1 })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ user_id: w.bob.id, word_id: w.words.aliceInGroup.id, quiz_correct: 1 })

    // tiến trình của alice cho cùng từ đó không bị ảnh hưởng
    const alice = (await w.alice.get('/progress')).body.find((p) => p.word_id === w.words.aliceInGroup.id)
    expect(alice.quiz_correct).toBe(0)
  })

  it.each([
    ['bob với từ cá nhân của alice', 'bob', 'alicePersonal', 404],
    ['carol với từ trong nhóm', 'carol', 'aliceInGroup', 404],
    ['sam (super admin) học từ trong nhóm', 'sam', 'bobInGroup', 200],
    ['sam với từ cá nhân của carol', 'sam', 'carolPersonal', 404],
  ])('%s %s %s → %i', async (_label, who, wordKey, status) => {
    expect((await w[who].patch(`/progress/${w.words[wordKey].id}`, { repetitions: 1 })).status).toBe(status)
  })

  it.each([
    ['ease_factor quá nhỏ', { ease_factor: 0 }],
    ['interval âm', { interval_days: -1 }],
    ['repetitions không nguyên', { repetitions: 1.5 }],
    ['ngày sai định dạng', { due_at: 'ngày mai' }],
    ['số dạng chuỗi', { quiz_correct: '3' }],
    ['không có field hợp lệ', { word: 'x' }],
  ])('từ chối dữ liệu vô lý: %s', async (_label, body) => {
    const res = await w.bob.patch(`/progress/${w.words.bobPersonal.id}`, body)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('validation_error')
  })
})

describe('/review-log', () => {
  const log = (user, body) => user.post('/review-log', body)

  it('ghi nhật ký: giờ client quá cũ (ngoài 7 ngày) bị bỏ qua, lấy theo giờ server', async () => {
    const before = Date.now()
    const res = await log(w.bob, {
      word_id: w.words.bobPersonal.id,
      quality: 2,
      reviewed_at: '2020-01-01T00:00:00Z',
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ word_id: w.words.bobPersonal.id, quality: 2, direction: 'recognition' })
    expect(new Date(res.body.reviewed_at).getTime()).toBeGreaterThanOrEqual(before - 1000)
  })

  it('đồng bộ kết quả ôn lúc mất mạng: giữ giờ ôn thật nếu trong 7 ngày gần nhất; giờ tương lai → giờ server', async () => {
    const id = w.words.bobPersonal.id
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString()
    const kept = await log(w.bob, { word_id: id, quality: 2, reviewed_at: twoDaysAgo })
    expect(kept.status).toBe(201)
    expect(new Date(kept.body.reviewed_at).toISOString()).toBe(twoDaysAgo)

    const before = Date.now()
    const future = await log(w.bob, {
      word_id: id,
      quality: 2,
      reviewed_at: new Date(before + 86_400_000).toISOString(),
    })
    expect(new Date(future.body.reviewed_at).getTime()).toBeLessThanOrEqual(Date.now() + 1000)
    expect((await log(w.bob, { word_id: id, quality: 2, reviewed_at: 'hôm qua' })).status).toBe(400)
  })

  it('đếm số lần học mỗi từ: mọi nguồn, cả hai chiều; mỗi người đếm riêng; client không sửa được', async () => {
    const id = w.words.aliceInGroup.id // từ trong nhóm: Bob học lần đầu, chưa có dòng tiến trình
    const studyCount = async (user) => (await user.get('/words')).body.find((x) => x.id === id).study_count
    expect(await studyCount(w.bob)).toBeNull() // chưa có dòng tiến trình → các cột tiến trình là null

    await log(w.bob, { word_id: id, quality: 2 })
    await log(w.bob, { word_id: id, quality: 0, source: 'quiz' })
    await log(w.bob, { word_id: id, quality: 2, source: 'spelling', direction: 'production' })
    await log(w.alice, { word_id: id, quality: 2 })
    expect(await studyCount(w.bob)).toBe(3)
    expect(await studyCount(w.alice)).toBe(1)

    await w.bob.patch(`/progress/${id}`, { study_count: 999 })
    await w.bob.patch(`/progress/${id}`, { repetitions: 1 })
    expect(await studyCount(w.bob)).toBe(3)
  })

  it('ghi nguồn của lượt ôn (tab Học / Quiz / Chính tả); mặc định là tab Học', async () => {
    const id = w.words.bobPersonal.id
    expect((await log(w.bob, { word_id: id, quality: 2 })).body.source).toBe('study')
    expect((await log(w.bob, { word_id: id, quality: 0, source: 'quiz' })).body.source).toBe('quiz')
    expect((await log(w.bob, { word_id: id, quality: 2, source: 'spelling', direction: 'production' })).status).toBe(
      201,
    )
    expect((await log(w.bob, { word_id: id, quality: 2, source: 'tenses' })).status).toBe(400)
    const sources = (await w.bob.get('/review-log')).body.map((r) => r.source).toSorted()
    expect(sources).toEqual(['quiz', 'spelling', 'study'])
  })

  it('kiểm tra điểm chấm, chiều học và quyền xem từ', async () => {
    const id = w.words.bobPersonal.id
    expect((await log(w.bob, { word_id: id, quality: 4 })).status).toBe(400)
    expect((await log(w.bob, { word_id: id, quality: 1, direction: 'ngược' })).status).toBe(400)
    expect((await log(w.bob, { word_id: id, quality: 1, direction: 'production' })).status).toBe(201)
    expect((await log(w.carol, { word_id: id, quality: 1 })).status).toBe(404)
  })

  it('chỉ đọc nhật ký của mình, mặc định 90 ngày gần nhất, mới nhất trước', async () => {
    await log(w.bob, { word_id: w.words.bobPersonal.id, quality: 1 })
    await log(w.bob, { word_id: w.words.bobInGroup.id, quality: 3 })
    await log(w.alice, { word_id: w.words.aliceInGroup.id, quality: 2 })
    await pool.query(
      "insert into review_log (user_id, word_id, quality, reviewed_at) values ($1, $2, 0, now() - interval '100 days')",
      [w.bob.id, w.words.bobPersonal.id],
    )

    const recent = (await w.bob.get('/review-log')).body
    expect(recent.map((r) => r.quality)).toEqual([3, 1])

    const since = new Date(Date.now() - 120 * 86_400_000).toISOString()
    const all = (await w.bob.get(`/review-log?since=${encodeURIComponent(since)}`)).body
    expect(all).toHaveLength(3)

    expect((await w.bob.get('/review-log?since=hom-qua')).status).toBe(400)
  })
})

describe('/settings', () => {
  const DEFAULTS = {
    // 5 từ mới/ngày ≈ 12 phút khi đã vào nhịp (migration 010; trước đây 20 ≈ 47 phút).
    new_cards_per_day: 5,
    session_size: 10,
    daily_goal: 20,
    reviews_per_day: 100,
    // Nhắc học (migration 008) — mặc định TẮT, 20h, giờ Việt Nam.
    reminder_enabled: false,
    reminder_hour: 20,
    reminder_tz: 'Asia/Ho_Chi_Minh',
  }

  it('chưa lưu bao giờ → trả giá trị mặc định', async () => {
    expect((await w.bob.get('/settings')).body).toEqual(DEFAULTS)
  })

  it('mặc định của BẢNG user_settings khớp mặc định API trả về (dòng tạo bằng SQL thuần)', async () => {
    const cols = Object.keys(DEFAULTS).join(', ')
    const { rows } = await pool.query(`insert into user_settings (user_id) values ($1) returning ${cols}`, [w.bob.id])
    expect(rows[0]).toEqual(DEFAULTS)
  })

  it('lưu rồi đọc lại; không ảnh hưởng người khác', async () => {
    const res = await w.bob.put('/settings', { new_cards_per_day: 35, user_id: w.alice.id })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ...DEFAULTS, new_cards_per_day: 35 })
    expect((await w.bob.get('/settings')).body).toEqual({ ...DEFAULTS, new_cards_per_day: 35 })
    expect((await w.alice.get('/settings')).body).toEqual(DEFAULTS)

    await w.bob.put('/settings', { new_cards_per_day: 0 }) // 0 = tạm dừng học từ mới
    expect((await w.bob.get('/settings')).body.new_cards_per_day).toBe(0)
  })

  it('chỉ đổi field gửi lên, field khác giữ nguyên (kể cả ở lần lưu đầu tiên)', async () => {
    const first = await w.bob.put('/settings', { session_size: 5 })
    expect(first.body).toEqual({ ...DEFAULTS, session_size: 5 })
    const second = await w.bob.put('/settings', { daily_goal: 40, reviews_per_day: 60 })
    expect(second.body).toEqual({ ...DEFAULTS, session_size: 5, daily_goal: 40, reviews_per_day: 60 })
  })

  it.each([[201], [-1], [2.5], ['20']])('từ chối giá trị %j', async (value) => {
    const res = await w.bob.put('/settings', { new_cards_per_day: value })
    expect(res.status).toBe(400)
  })

  it.each([
    [{ session_size: 2 }],
    [{ session_size: 51 }],
    [{ daily_goal: 0 }],
    [{ reviews_per_day: 9 }],
    [{ reviews_per_day: 1001 }],
    [{}],
    [{ khong_co_field_nay: 1 }],
  ])('từ chối %j', async (body) => {
    expect((await w.bob.put('/settings', body)).status).toBe(400)
  })
})

describe('GET /review-log/daily', () => {
  it('gộp số lượt theo ngày, cắt ngày theo múi giờ gửi lên', async () => {
    const word = (await w.alice.get('/words')).body[0]
    // 23:30 ngày 1/6 theo giờ UTC = 06:30 ngày 2/6 theo giờ Việt Nam → phải rơi vào 2 ngày khác
    // nhau tuỳ múi giờ. Ghi thẳng vào DB vì API chỉ nhận reviewed_at trong 7 ngày gần nhất.
    for (const at of ['2026-06-01T23:30:00Z', '2026-06-01T23:40:00Z', '2026-06-03T10:00:00Z']) {
      await pool.query('insert into review_log (user_id, word_id, quality, reviewed_at) values ($1, $2, 2, $3)', [
        w.alice.id,
        word.id,
        at,
      ])
    }
    const since = '2026-05-01T00:00:00Z'
    const utc = (await w.alice.get(`/review-log/daily?since=${since}`)).body
    expect(utc).toEqual([
      { day: '2026-06-01', count: 2 },
      { day: '2026-06-03', count: 1 },
    ])

    const vn = (await w.alice.get(`/review-log/daily?since=${since}&tz=Asia/Ho_Chi_Minh`)).body
    expect(vn).toEqual([
      { day: '2026-06-02', count: 2 },
      { day: '2026-06-03', count: 1 },
    ])
  })

  it('múi giờ không có thật → 400 ngay cả khi chưa có lượt ôn nào, không phải lỗi 500', async () => {
    const res = await w.alice.get('/review-log/daily?tz=Khong/Co_That')
    expect(res.status).toBe(400)
    expect(res.body.error.message).toMatch(/Múi giờ/)
  })

  it('chỉ đếm lượt ôn của chính mình', async () => {
    expect((await w.carol.get('/review-log/daily')).body).toEqual([])
  })
})

// Số lần quên (migration 007): chỉ tăng, dùng để nhận ra từ mãi không thuộc.
describe('lapses', () => {
  it('mặc định 0, cập nhật được qua PATCH /progress, và trả kèm trong GET /words', async () => {
    const word = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    expect(word.lapses).toBe(0)

    expect((await w.alice.patch(`/progress/${word.id}`, { lapses: 3 })).status).toBe(200)
    expect((await w.alice.get('/words')).body.find((x) => x.word === 'apple').lapses).toBe(3)
  })

  it('giá trị âm bị từ chối', async () => {
    const word = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    expect((await w.alice.patch(`/progress/${word.id}`, { lapses: -1 })).status).toBe(400)
  })
})

// Trạng thái trí nhớ FSRS (migration 012): null tới khi thẻ được chấm lần đầu theo FSRS.
describe('stability/difficulty (FSRS)', () => {
  it('mặc định null, lưu được cho cả 2 chiều học và trả kèm trong GET /words', async () => {
    const word = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    expect(word).toMatchObject({ stability: null, difficulty: null, stability_rev: null, difficulty_rev: null })

    const res = await w.alice.patch(`/progress/${word.id}`, {
      stability: 2.3065,
      difficulty: 2.1181,
      stability_rev: 8.2956,
      difficulty_rev: 1,
    })
    expect(res.status).toBe(200)
    const after = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    expect(after.stability).toBeCloseTo(2.3065, 4)
    expect(after.difficulty).toBeCloseTo(2.1181, 4)
    expect(after.stability_rev).toBeCloseTo(8.2956, 4)
    expect(after.difficulty_rev).toBe(1)
  })

  it('giá trị ngoài miền của mô hình bị từ chối', async () => {
    const word = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    for (const body of [{ stability: 0 }, { stability: 40000 }, { difficulty: 0.5 }, { difficulty_rev: 11 }]) {
      expect((await w.alice.patch(`/progress/${word.id}`, body)).status).toBe(400)
    }
  })
})
