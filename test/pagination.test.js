import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, createUser, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()

// Đi hết các trang, trả về mọi dòng + số trang đã gọi.
async function readAll(user, path, limit) {
  const items = []
  let cursor
  let pages = 0
  do {
    const res = await user.get(`${path}?limit=${limit}${cursor ? `&cursor=${cursor}` : ''}`)
    expect(res.status).toBe(200)
    expect(res.body.items.length).toBeLessThanOrEqual(limit)
    items.push(...res.body.items)
    cursor = res.body.next_cursor
    pages++
  } while (cursor)
  return { items, pages }
}

describe('Phân trang GET /words', () => {
  let an
  beforeEach(async () => {
    an = await createUser(app, 'an@example.com')
    // 7 từ thêm 1 lần (CÙNG created_at — trường hợp khó nhất cho con trỏ) + 3 từ thêm lẻ.
    await an.post('/words/bulk', {
      words: Array.from({ length: 7 }, (_, i) => ({ word: `bulk-${i}`, meaning: 'nghĩa' })),
    })
    for (const word of ['x', 'y', 'z']) await an.post('/words', { word, meaning: 'nghĩa' })
  })

  it('không truyền limit → vẫn trả mảng đầy đủ như trước', async () => {
    const res = await an.get('/words')
    expect(Array.isArray(res.body)).toBe(true)
    expect(res.body).toHaveLength(10)
  })

  it.each([1, 3, 4, 10, 50])(
    'limit=%i: đi hết các trang được ĐÚNG danh sách đầy đủ, cùng thứ tự, không lặp/sót',
    async (limit) => {
      const full = (await an.get('/words')).body
      const { items, pages } = await readAll(an, '/words', limit)
      expect(items.map((w) => w.id)).toEqual(full.map((w) => w.id))
      expect(items[0]).toEqual(full[0]) // không lộ cột nội bộ dùng làm con trỏ
      expect(pages).toBe(Math.max(1, Math.ceil(10 / limit)))
    },
  )

  it('phân trang vẫn áp đúng quyền xem (từ nhóm + từ riêng, không lộ từ người khác)', async () => {
    const w = await buildWorld(app, pool)
    const { items } = await readAll(w.bob, '/words', 2)
    expect(items.map((x) => x.word).toSorted()).toEqual(['banana', 'group-by-alice', 'group-by-bob', 'loose'])
  })

  it('limit/cursor không hợp lệ → 400', async () => {
    expect((await an.get('/words?limit=0')).status).toBe(400)
    expect((await an.get('/words?limit=1001')).status).toBe(400)
    expect((await an.get('/words?limit=abc')).status).toBe(400)
    const bad = await an.get('/words?limit=5&cursor=khong-phai-con-tro')
    expect(bad.status).toBe(400)
    expect(bad.body.error.code).toBe('invalid_cursor')
    const forged = Buffer.from(JSON.stringify({ c: 'not-a-time', id: an.id })).toString('base64url')
    expect((await an.get(`/words?limit=5&cursor=${forged}`)).status).toBe(400)
  })
})

describe('Phân trang GET /progress', () => {
  it('đi hết các trang được đúng toàn bộ tiến trình của MÌNH; không limit → mảng như trước', async () => {
    const w = await buildWorld(app, pool)
    await w.bob.patch(`/progress/${w.words.aliceInGroup.id}`, { repetitions: 3 })
    const full = (await w.bob.get('/progress')).body
    expect(Array.isArray(full)).toBe(true)

    const { items, pages } = await readAll(w.bob, '/progress', 2)
    expect(items.map((p) => p.word_id).toSorted()).toEqual(full.map((p) => p.word_id).toSorted())
    expect(new Set(items.map((p) => p.word_id)).size).toBe(items.length)
    expect(items.every((p) => p.user_id === w.bob.id)).toBe(true)
    expect(pages).toBe(Math.ceil(full.length / 2))
    expect((await w.bob.get('/progress?limit=2&cursor=sai')).status).toBe(400)
  })
})
