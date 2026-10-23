import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const note = (over = {}) => ({ id: 'n1', type: 'word', text: 'serendipity', ...over })

describe('/readings', () => {
  it('tạo bài đọc: giá trị mặc định, bỏ qua user_id client gửi', async () => {
    const res = await w.bob.post('/readings', { content: 'Hello there.', user_id: w.alice.id })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({ user_id: w.bob.id, title: '', content: 'Hello there.', notes: [] })
  })

  it('lưu ghi chú: làm sạch, điền mặc định; PATCH notes thay cả danh sách', async () => {
    const { id } = (await w.bob.post('/readings', { content: 'x' })).body
    const res = await w.bob.patch(`/readings/${id}`, {
      notes: [
        note({ text: '  serendipity ' }),
        note({ id: 'n2', type: 'grammar', text: 'used to + V', explanation: 'thói quen cũ' }),
      ],
    })
    expect(res.status).toBe(200)
    expect(res.body.notes).toEqual([
      { id: 'n1', type: 'word', text: 'serendipity', meaning: '', explanation: '', example: '', saved_to: null },
      {
        id: 'n2',
        type: 'grammar',
        text: 'used to + V',
        meaning: '',
        explanation: 'thói quen cũ',
        example: '',
        saved_to: null,
      },
    ])
    const again = await w.bob.patch(`/readings/${id}`, { notes: [] })
    expect(again.body.notes).toEqual([])
    expect(again.body.content).toBe('x') // field không gửi giữ nguyên
  })

  it('sửa xong thì lên đầu danh sách', async () => {
    const a = (await w.bob.post('/readings', { title: 'A' })).body
    await w.bob.post('/readings', { title: 'B' })
    await w.bob.patch(`/readings/${a.id}`, { title: 'A2' })
    expect((await w.bob.get('/readings')).body.map((r) => r.title)).toEqual(['A2', 'B'])
  })

  it('là sổ tay CÁ NHÂN: người khác không thấy, không sửa, không xoá được', async () => {
    const own = (await w.bob.post('/readings', { title: 'riêng' })).body
    for (const other of [w.alice, w.carol, w.sam]) {
      expect((await other.get('/readings')).body).toEqual([])
      expect((await other.patch(`/readings/${own.id}`, { title: 'x' })).status).toBe(404)
      expect((await other.del(`/readings/${own.id}`)).status).toBe(404)
    }
    expect((await w.bob.del(`/readings/${own.id}`)).status).toBe(204)
    expect((await w.bob.get('/readings')).body).toEqual([])
  })

  it.each([
    ['loại ghi chú lạ', { notes: [note({ type: 'idiom' })] }],
    ['ghi chú trống', { notes: [note({ text: '   ' })] }],
    ['trùng id ghi chú', { notes: [note(), note()] }],
    ['saved_to sai', { notes: [note({ saved_to: { kind: 'word', id: 'abc' } })] }],
    ['văn bản quá dài', { content: 'a'.repeat(50_001) }],
    ['quá nhiều ghi chú', { notes: Array.from({ length: 301 }, (_, i) => note({ id: `n${i}` })) }],
    ['PATCH rỗng', {}],
  ])('từ chối %s → 400', async (_label, body) => {
    const { id } = (await w.bob.post('/readings', {})).body
    expect((await w.bob.patch(`/readings/${id}`, body)).status).toBe(400)
  })

  it('xoá tài khoản thì bài đọc mất theo', async () => {
    await w.bob.post('/readings', { title: 'x' })
    await pool.query('delete from users where id = $1', [w.bob.id])
    expect((await pool.query('select count(*)::int as n from readings')).rows[0].n).toBe(0)
  })
})
