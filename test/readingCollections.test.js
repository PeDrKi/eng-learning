import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const deckOf = async (id) => (await pool.query('select * from decks where id = $1', [id])).rows[0]

describe('/reading-collections', () => {
  it('tạo bộ: tự tạo NGAY chủ đề cá nhân cùng tên; liệt kê kèm tên chủ đề và số bài', async () => {
    const res = await w.bob.post('/reading-collections', { name: '  Harry Potter  ', description: 'Tập 1' })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ user_id: w.bob.id, name: 'Harry Potter', description: 'Tập 1', reading_count: 0 })
    const deck = await deckOf(res.body.deck_id)
    expect(deck).toMatchObject({ user_id: w.bob.id, group_id: null, name: 'Harry Potter' })
    expect(res.body.deck_name).toBe('Harry Potter')
    expect(res.body.deck).toMatchObject({ id: res.body.deck_id, name: 'Harry Potter' })

    await w.bob.post('/readings', { content: 'Page one.', collection_id: res.body.id })
    const list = (await w.bob.get('/reading-collections')).body
    expect(list).toEqual([expect.objectContaining({ id: res.body.id, deck_name: 'Harry Potter', reading_count: 1 })])
  })

  it('gắn chủ đề có sẵn: của mình / của nhóm mình là thành viên thì được; chủ đề người khác → 400', async () => {
    const own = await w.bob.post('/reading-collections', { name: 'A', deck_id: w.decks.bob.id })
    expect(own.status).toBe(201)
    expect(own.body.deck_id).toBe(w.decks.bob.id)
    expect((await w.bob.post('/reading-collections', { name: 'B', deck_id: w.decks.group.id })).status).toBe(201)
    const other = await w.bob.post('/reading-collections', { name: 'C', deck_id: w.decks.carol.id })
    expect(other.status).toBe(400)
    expect(other.body.error.code).toBe('deck_not_found')
    // Không tạo thêm chủ đề nào khi gắn chủ đề có sẵn hoặc khi bị từ chối.
    expect((await pool.query('select count(*)::int as n from decks where user_id = $1', [w.bob.id])).rows[0].n).toBe(1)
  })

  it('đổi tên bộ → chủ đề đổi tên theo nếu vẫn mang tên cũ; đã đặt tên khác thì giữ nguyên', async () => {
    const c = (await w.bob.post('/reading-collections', { name: 'Báo' })).body
    const renamed = await w.bob.patch(`/reading-collections/${c.id}`, { name: 'Báo VnExpress' })
    expect(renamed.status).toBe(200)
    expect(renamed.body).toMatchObject({ name: 'Báo VnExpress', deck_name: 'Báo VnExpress' })
    await pool.query("update decks set name = 'Từ báo' where id = $1", [c.deck_id])
    await w.bob.patch(`/reading-collections/${c.id}`, { name: 'Báo Tuổi Trẻ' })
    expect((await deckOf(c.deck_id)).name).toBe('Từ báo')
    // Bỏ liên kết chủ đề.
    expect((await w.bob.patch(`/reading-collections/${c.id}`, { deck_id: null })).body).toMatchObject({
      deck_id: null,
      deck_name: null,
    })
  })

  it('xoá bộ: bài về "Ghi chú", chủ đề + từ giữ nguyên; delete_readings=true thì xoá luôn bài', async () => {
    const c = (await w.bob.post('/reading-collections', { name: 'Sách' })).body
    const r = (await w.bob.post('/readings', { content: 'x', collection_id: c.id })).body
    const word = (await w.bob.post('/words', { word: 'tome', meaning: 'tập sách', deck_id: c.deck_id })).body
    expect((await w.bob.del(`/reading-collections/${c.id}`)).status).toBe(204)
    const after = (await w.bob.get('/readings')).body.find((x) => x.id === r.id)
    expect(after.collection_id).toBeNull()
    expect(await deckOf(c.deck_id)).toBeTruthy()
    expect((await pool.query('select deck_id from words where id = $1', [word.id])).rows[0].deck_id).toBe(c.deck_id)

    const c2 = (await w.bob.post('/reading-collections', { name: 'Sách 2' })).body
    await w.bob.post('/readings', { content: 'y', collection_id: c2.id })
    expect((await w.bob.del(`/reading-collections/${c2.id}?delete_readings=true`)).status).toBe(204)
    expect((await w.bob.get('/readings')).body.map((x) => x.content)).toEqual(['x'])
  })

  it('sổ tay CÁ NHÂN: người khác không thấy, không sửa, không xoá, không thêm bài vào bộ của mình', async () => {
    const c = (await w.bob.post('/reading-collections', { name: 'Riêng' })).body
    for (const other of [w.alice, w.carol, w.sam]) {
      expect((await other.get('/reading-collections')).body).toEqual([])
      expect((await other.patch(`/reading-collections/${c.id}`, { name: 'x' })).status).toBe(404)
      expect((await other.del(`/reading-collections/${c.id}`)).status).toBe(404)
      const res = await other.post('/readings', { content: 'x', collection_id: c.id })
      expect(res.status).toBe(400)
      expect(res.body.error.code).toBe('collection_not_found')
    }
  })

  it.each([
    ['tên trống', { name: '   ' }],
    ['tên quá dài', { name: 'a'.repeat(101) }],
    ['mô tả quá dài', { name: 'a', description: 'x'.repeat(501) }],
    ['deck_id sai', { name: 'a', deck_id: 'abc' }],
  ])('tạo bộ: từ chối %s → 400', async (_label, body) => {
    expect((await w.bob.post('/reading-collections', body)).status).toBe(400)
  })
})

describe('/readings — bộ và thứ tự trang', () => {
  it('thêm bài vào bộ thì xếp cuối; chuyển bộ thì xếp cuối bộ mới; về "Ghi chú" thì position 0', async () => {
    const a = (await w.bob.post('/reading-collections', { name: 'A' })).body
    const b = (await w.bob.post('/reading-collections', { name: 'B' })).body
    const p1 = (await w.bob.post('/readings', { content: '1', collection_id: a.id })).body
    const p2 = (await w.bob.post('/readings', { content: '2', collection_id: a.id })).body
    const loose = (await w.bob.post('/readings', { content: 'lẻ' })).body
    expect([p1.position, p2.position, loose.position, loose.collection_id]).toEqual([0, 1, 0, null])

    await w.bob.post('/readings', { content: '3', collection_id: b.id })
    const moved = (await w.bob.patch(`/readings/${p1.id}`, { collection_id: b.id })).body
    expect(moved).toMatchObject({ collection_id: b.id, position: 1 })
    const back = (await w.bob.patch(`/readings/${moved.id}`, { collection_id: null })).body
    expect(back).toMatchObject({ collection_id: null, position: 0 })

    // Sắp xếp lại trang bằng position.
    expect((await w.bob.patch(`/readings/${p2.id}`, { position: 5 })).body.position).toBe(5)
    expect((await w.bob.patch(`/readings/${p2.id}`, { position: -1 })).status).toBe(400)
  })

  it('bài cũ (trước migration 031) đều là "Ghi chú"', async () => {
    const r = (await w.bob.post('/readings', { content: 'cũ' })).body
    expect(r).toMatchObject({ collection_id: null, position: 0 })
  })
})
