import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const SESSION = '0f3c2a8e-4b1d-4c7e-9a55-1d2e3f4a5b6c'
const review = (user, word_id, extra = {}) =>
  user.post('/review-log', { word_id, quality: 2, direction: 'recognition', ...extra })
const signals = async (user) =>
  (
    await pool.query(
      'select source, answer_ms, wrong_answer, session_id from review_log where user_id = $1 order by reviewed_at, id',
      [user.id],
    )
  ).rows

describe('POST /review-log — dữ liệu cho lịch ôn thông minh (migration 030)', () => {
  it('ghi thời gian trả lời, đáp án sai, mã buổi học; app bản cũ không gửi vẫn ghi được', async () => {
    const word = w.words.bobPersonal.id
    expect((await review(w.bob, word, { answer_ms: 2350, session_id: SESSION })).status).toBe(201)
    expect(
      (await review(w.bob, word, { source: 'quiz', quality: 0, wrong_answer: '  quả chuối ', session_id: SESSION }))
        .status,
    ).toBe(201)
    expect((await review(w.bob, word)).status).toBe(201)
    expect(await signals(w.bob)).toEqual([
      { source: 'study', answer_ms: 2350, wrong_answer: null, session_id: SESSION },
      { source: 'quiz', answer_ms: null, wrong_answer: 'quả chuối', session_id: SESSION },
      { source: 'study', answer_ms: null, wrong_answer: null, session_id: null },
    ])
  })

  it('thời gian quá 1 giờ bỏ qua, đáp án sai dài bị cắt còn 200 ký tự; giá trị sai kiểu → 400', async () => {
    const word = w.words.bobPersonal.id
    expect((await review(w.bob, word, { answer_ms: 3_600_001, wrong_answer: 'x'.repeat(500) })).status).toBe(201)
    const [row] = await signals(w.bob)
    expect(row.answer_ms).toBeNull()
    expect(row.wrong_answer).toHaveLength(200)
    expect((await review(w.bob, word, { answer_ms: -1 })).status).toBe(400)
    expect((await review(w.bob, word, { answer_ms: 1.5 })).status).toBe(400)
    expect((await review(w.bob, word, { session_id: 'abc' })).status).toBe(400)
  })

  it('TẮT lịch ôn thông minh: lượt ôn vẫn ghi (chuỗi ngày học) nhưng không ghi 3 trường mới', async () => {
    expect((await w.bob.put('/settings', { personalization_enabled: false })).status).toBe(200)
    await review(w.bob, w.words.bobPersonal.id, { answer_ms: 1200, wrong_answer: 'sai', session_id: SESSION })
    expect(await signals(w.bob)).toEqual([{ source: 'study', answer_ms: null, wrong_answer: null, session_id: null }])
  })
})

describe('GET /review-log/summary', () => {
  it('chỉ đếm lượt chấm ở tab Học của chính mình; kèm ngưỡng 1000', async () => {
    const word = w.words.bobPersonal.id
    await review(w.bob, word)
    await review(w.bob, word, { direction: 'production' })
    await review(w.bob, word, { source: 'quiz' })
    await review(w.bob, word, { source: 'spelling', direction: 'production' })
    await review(w.alice, w.words.alicePersonal.id)
    expect((await w.bob.get('/review-log/summary')).body).toEqual({ study_reviews: 2, threshold: 1000 })
    expect((await w.carol.get('/review-log/summary')).body).toEqual({ study_reviews: 0, threshold: 1000 })
  })
})

describe('GET /review-log/export — tải nhật ký ôn của chính mình', () => {
  it('JSON: đủ cột, kèm chữ của từ; không có lượt ôn của người khác', async () => {
    await review(w.bob, w.words.bobPersonal.id, { answer_ms: 900 })
    await review(w.alice, w.words.alicePersonal.id)
    const res = await w.bob.get('/review-log/export')
    expect(res.status).toBe(200)
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="lich-su-on-.*\.json"/)
    expect(res.body.reviews).toEqual([
      expect.objectContaining({ word: 'banana', source: 'study', quality: 2, answer_ms: 900, phrase: null }),
    ])
  })

  it('CSV: có BOM, dòng tiêu đề, bọc nháy ô có dấu phẩy, chặn ô bị Excel hiểu là công thức', async () => {
    const formula = (await w.bob.post('/words', { word: '=HYPERLINK("x")', meaning: 'm' })).body
    await review(w.bob, formula.id, { source: 'quiz', quality: 0, wrong_answer: 'a, b' })
    const res = await w.bob.get('/review-log/export?format=csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/csv/)
    const text = res.text
    expect(text.charCodeAt(0)).toBe(0xfeff)
    const [header, line] = text.slice(1).split('\r\n')
    expect(header).toBe(
      'reviewed_at,source,direction,quality,answer_ms,wrong_answer,session_id,word_id,word,phrase_id,phrase',
    )
    expect(line).toContain('"a, b"')
    expect(line).toContain(`"'=HYPERLINK(""x"")"`)
    expect((await w.bob.get('/review-log/export?format=xml')).status).toBe(400)
  })
})

describe('/settings — lịch ôn thông minh', () => {
  it('mặc định BẬT, chưa xem thông báo; lưu được và chỉ ảnh hưởng chính mình', async () => {
    expect((await w.bob.get('/settings')).body).toMatchObject({
      personalization_enabled: true,
      ml_notice_seen_at: null,
    })
    const seen = '2026-11-01T08:00:00.000Z'
    const res = await w.bob.put('/settings', { personalization_enabled: false, ml_notice_seen_at: seen })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ personalization_enabled: false })
    expect(new Date(res.body.ml_notice_seen_at).toISOString()).toBe(seen)
    // Lưu field khác không làm mất 2 giá trị này.
    await w.bob.put('/settings', { daily_goal: 30 })
    expect((await w.bob.get('/settings')).body).toMatchObject({ personalization_enabled: false, daily_goal: 30 })
    expect((await w.alice.get('/settings')).body).toMatchObject({ personalization_enabled: true })
    expect((await w.bob.put('/settings', { ml_notice_seen_at: 'hôm qua' })).status).toBe(400)
  })
})

describe('GET /admin/overview — Dữ liệu FSRS', () => {
  it('chỉ là con số gộp; chỉ tính lượt chấm tab Học của người CHO PHÉP dùng dữ liệu', async () => {
    const add = async (user, n, source = 'study') => {
      await pool.query(
        `insert into review_log (user_id, quality, direction, source)
         select $1, 2, 'recognition', $3 from generate_series(1, $2)`,
        [user.id, n, source],
      )
    }
    await add(w.alice, 1000)
    await add(w.bob, 450)
    await add(w.bob, 900, 'quiz') // không tính
    await add(w.carol, 1200)
    await w.carol.put('/settings', { personalization_enabled: false }) // tắt → không tính
    const { body } = await w.sam.get('/admin/overview')
    expect(body.fsrs_data).toEqual({
      study_reviews: 1450,
      learners: 2,
      users_400: 2,
      users_1000: 1,
      opted_out: 1,
    })
    expect(JSON.stringify(body.fsrs_data)).not.toMatch(/@/)
  })
})
