import { beforeEach, describe, expect, it } from 'vitest'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const NOTE = {
  id: 'n1',
  type: 'word',
  text: 'proud',
  meaning: 'tự hào',
  saved_to: { kind: 'word', id: '11111111-1111-4111-8111-111111111111' },
}

// Bob: bộ "Harry Potter" có 2 trang (trang 2 có bản dịch) + 1 bài lẻ trong "Ghi chú".
async function bobLibrary() {
  const c = (await w.bob.post('/reading-collections', { name: 'Harry Potter', description: 'Tập 1' })).body
  const p1 = (await w.bob.post('/readings', { content: 'Page one.', collection_id: c.id, notes: [NOTE] })).body
  const p2 = (
    await w.bob.post('/readings', { content: 'Page two.', collection_id: c.id, translations: ['Trang hai.'] })
  ).body
  const loose = (await w.bob.post('/readings', { title: 'Tin ngắn', content: 'Breaking news.' })).body
  return { c, p1, p2, loose }
}

describe('bài đọc cộng đồng — mặc định riêng tư', () => {
  it('chưa chia sẻ: người khác không thấy, không có ở Khám phá', async () => {
    const { c, loose } = await bobLibrary()
    expect((await w.alice.get(`/community/reading-collections/${c.id}`)).status).toBe(404)
    expect((await w.alice.get(`/community/readings/${loose.id}`)).status).toBe(404)
    expect((await w.alice.get('/community/readings')).body).toEqual([])
    // Chủ sở hữu vẫn xem được bản của mình.
    expect((await w.bob.get(`/community/reading-collections/${c.id}`)).status).toBe(200)
  })
})

describe('chia sẻ cả BỘ', () => {
  it('công khai: người khác đọc được cả bộ theo thứ tự trang, ghi chú không lộ saved_to; chủ đề đi kèm cũng công khai', async () => {
    const { c } = await bobLibrary()
    const res = await w.bob.put(`/community/reading-collections/${c.id}/publish`, {
      include_translations: true,
      include_content: true,
      publish_deck: true,
    })
    expect(res.status).toBe(200)
    expect(res.body).toMatchObject({ is_public: true, deck_published: true })
    expect((await pool.query('select is_public from decks where id = $1', [c.deck_id])).rows[0].is_public).toBe(true)

    const view = (await w.alice.get(`/community/reading-collections/${c.id}`)).body
    expect(view).toMatchObject({ name: 'Harry Potter', mine: false, followed: false })
    expect(JSON.stringify(view)).not.toMatch(/@example\.com|user_id/)
    expect(view.readings.map((r) => r.content)).toEqual(['Page one.', 'Page two.'])
    expect(view.readings[0].notes).toEqual([
      { id: 'n1', type: 'word', text: 'proud', meaning: 'tự hào', explanation: '', example: '' },
    ])
    expect(view.readings[1].translations).toEqual(['Trang hai.'])
  })

  it('không kèm bản dịch → người khác không thấy bản dịch; không kèm chủ đề → chủ đề vẫn riêng tư', async () => {
    const { c, p2 } = await bobLibrary()
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {
      include_translations: false,
      publish_deck: false,
    })
    const view = (await w.alice.get(`/community/reading-collections/${c.id}`)).body
    expect(view.readings[1]).toMatchObject({ translations: [], translations_shared: false })
    // Trang trong bộ công khai mở riêng được, kèm thông tin bộ.
    const page = (await w.alice.get(`/community/readings/${p2.id}`)).body
    expect(page).toMatchObject({ translations: [], collection: { id: c.id, name: 'Harry Potter' } })
    expect((await pool.query('select is_public from decks where id = $1', [c.deck_id])).rows[0].is_public).toBe(false)
  })

  it('tắt chia sẻ: biến khỏi Khám phá, lượt lưu bị xoá; người đã sao chép vẫn giữ bản của họ', async () => {
    const { c } = await bobLibrary()
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, { include_content: true })
    expect((await w.alice.post(`/community/reading-collections/${c.id}/follow`)).status).toBe(200)
    const copy = await w.carol.post(`/community/reading-collections/${c.id}/copy`)
    expect(copy.status).toBe(201)
    expect(copy.body).toMatchObject({ readings_copied: 2, collection: { name: 'Harry Potter' } })
    expect(copy.body.deck).toMatchObject({ name: 'Harry Potter' })

    await w.bob.post(`/community/reading-collections/${c.id}/unpublish`)
    expect((await w.alice.get(`/community/reading-collections/${c.id}`)).status).toBe(404)
    expect((await pool.query('select count(*)::int as n from reading_follows')).rows[0].n).toBe(0)
    // Bản sao của Carol: bộ + 2 trang của Carol, ghi chú chưa "lưu" vào Sổ từ.
    const carolReadings = (await w.carol.get('/readings')).body
    expect(carolReadings.map((r) => r.content).toSorted()).toEqual(['Page one.', 'Page two.'])
    const copied = carolReadings.find((r) => r.content === 'Page one.')
    expect(copied.collection_id).toBe(copy.body.collection.id)
    expect(copied.notes[0]).toMatchObject({ text: 'proud', saved_to: null })
  })

  it('chỉ chủ sở hữu bật/tắt được; tự lưu bộ của mình → 400', async () => {
    const { c } = await bobLibrary()
    expect((await w.alice.put(`/community/reading-collections/${c.id}/publish`, {})).status).toBe(404)
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})
    expect((await w.bob.post(`/community/reading-collections/${c.id}/follow`)).status).toBe(400)
    expect((await w.alice.post(`/community/reading-collections/${c.id}/unpublish`)).status).toBe(404)
  })
})

describe('nguyên văn mặc định ẨN', () => {
  it('không bật "kèm nguyên văn": người khác chỉ thấy ghi chú + bản dịch; không tìm được trong nguyên văn; sao chép không nhận nguyên văn', async () => {
    const { c, p2, loose } = await bobLibrary()
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})
    await w.bob.put(`/community/readings/${loose.id}/publish`, {})

    const view = (await w.alice.get(`/community/reading-collections/${c.id}`)).body
    expect(view.include_content).toBe(false)
    expect(view.readings.map((r) => [r.content, r.content_shared])).toEqual([
      ['', false],
      ['', false],
    ])
    expect(view.readings[0].notes[0]).toMatchObject({ text: 'proud', meaning: 'tự hào' })
    expect(view.readings[1].translations).toEqual(['Trang hai.'])
    expect((await w.alice.get(`/community/readings/${p2.id}`)).body).toMatchObject({
      content: '',
      content_shared: false,
    })

    // Khám phá: bài lẻ không lộ đoạn đầu nguyên văn, và không tìm được bằng chữ trong nguyên văn.
    const listed = (await w.alice.get('/community/readings')).body.find((x) => x.id === loose.id)
    expect(listed.description).toBe('')
    expect((await w.alice.get('/community/readings?q=breaking')).body).toEqual([])

    const copy = (await w.alice.post(`/community/readings/${loose.id}/copy`)).body
    expect(copy.reading.content).toBe('')
    // Chủ sở hữu vẫn thấy đầy đủ bản của mình.
    expect((await w.bob.get(`/community/readings/${loose.id}`)).body.content).toBe('Breaking news.')
  })
})

describe('chia sẻ TỪNG bài lẻ', () => {
  it('công khai bài lẻ: có ở Khám phá cùng các bộ; tìm được; lọc "đã lưu"', async () => {
    const { c, loose } = await bobLibrary()
    expect(
      (
        await w.bob.put(`/community/readings/${loose.id}/publish`, {
          include_translations: false,
          include_content: true,
        })
      ).status,
    ).toBe(200)
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})
    const list = (await w.alice.get('/community/readings')).body
    expect(list.map((x) => [x.type, x.title]).toSorted()).toEqual([
      ['collection', 'Harry Potter'],
      ['reading', 'Tin ngắn'],
    ])
    expect(list.find((x) => x.type === 'collection')).toMatchObject({ reading_count: 2, note_count: 1 })
    expect((await w.alice.get('/community/readings?q=breaking')).body.map((x) => x.id)).toEqual([loose.id])

    await w.alice.post(`/community/readings/${loose.id}/follow`)
    const saved = (await w.alice.get('/community/readings?saved=true')).body
    expect(saved.map((x) => x.id)).toEqual([loose.id])
    await w.alice.del(`/community/readings/${loose.id}/follow`)
    expect((await w.alice.get('/community/readings?saved=true')).body).toEqual([])
  })

  it('sao chép bài lẻ → vào "Ghi chú" của người sao chép; bài trống không công khai được', async () => {
    const { loose } = await bobLibrary()
    await w.bob.put(`/community/readings/${loose.id}/publish`, { include_content: true })
    const copy = await w.alice.post(`/community/readings/${loose.id}/copy`)
    expect(copy.status).toBe(201)
    expect(copy.body.reading).toMatchObject({ content: 'Breaking news.', collection_id: null, user_id: w.alice.id })
    const empty = (await w.bob.post('/readings', { content: '' })).body
    expect((await w.bob.put(`/community/readings/${empty.id}/publish`, {})).status).toBe(400)
  })
})

describe('nhận xét', () => {
  it('cho cả bộ, cho 1 trang, cho bài lẻ — tách luồng; chủ bài nhận thông báo; chủ xoá được', async () => {
    const { c, p1, loose } = await bobLibrary()
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})
    await w.bob.put(`/community/readings/${loose.id}/publish`, {})

    const whole = await w.alice.post(`/community/reading-collections/${c.id}/comments`, { body: 'Bộ hay!' })
    expect(whole.status).toBe(201)
    await w.alice.post(`/community/reading-collections/${c.id}/comments`, { body: 'Trang 1 hay', reading_id: p1.id })
    await w.carol.post(`/community/readings/${loose.id}/comments`, { body: 'Tin nóng' })

    expect((await w.alice.get(`/community/reading-collections/${c.id}/comments`)).body.map((x) => x.body)).toEqual([
      'Bộ hay!',
    ])
    expect(
      (await w.alice.get(`/community/reading-collections/${c.id}/comments?reading_id=${p1.id}`)).body.map(
        (x) => x.body,
      ),
    ).toEqual(['Trang 1 hay'])
    expect((await w.alice.get(`/community/readings/${loose.id}/comments`)).body.map((x) => x.body)).toEqual([
      'Tin nóng',
    ])

    const notes = (await w.bob.get('/community/notifications')).body
    expect(notes.items.filter((n) => n.type === 'reading_comment')).toHaveLength(3)

    // Chủ bài xoá được nhận xét của người khác; người ngoài thì không.
    expect((await w.carol.del(`/community/reading-comments/${whole.body.id}`)).status).toBe(403)
    expect((await w.bob.del(`/community/reading-comments/${whole.body.id}`)).status).toBe(204)
  })

  it('bài riêng tư không nhận xét được; người bị chặn khỏi cộng đồng không nhận xét được', async () => {
    const { c, loose } = await bobLibrary()
    expect((await w.alice.post(`/community/readings/${loose.id}/comments`, { body: 'x' })).status).toBe(404)
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})
    await pool.query('update users set community_blocked_at = now() where id = $1', [w.alice.id])
    expect((await w.alice.post(`/community/reading-collections/${c.id}/comments`, { body: 'x' })).status).toBe(403)
  })
})

describe('báo cáo và kiểm duyệt', () => {
  it('báo cáo bộ → super admin gỡ: biến khỏi Khám phá, báo cáo đóng; chủ không công khai lại được', async () => {
    const { c } = await bobLibrary()
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})
    const report = await w.alice.post('/community/reports', {
      target_type: 'reading_collection',
      target_id: c.id,
      reason: '[Bản quyền] chép nguyên văn sách',
    })
    expect(report.status).toBe(201)
    const reports = (await w.sam.get('/admin/community/reports')).body
    expect(reports[0]).toMatchObject({ target_type: 'reading_collection', target: { title: 'Harry Potter' } })

    expect((await w.sam.post(`/admin/community/reading-collections/${c.id}/hide`)).status).toBeLessThan(300)
    expect((await w.alice.get('/community/readings')).body).toEqual([])
    expect((await w.alice.get(`/community/reading-collections/${c.id}`)).status).toBe(404)
    expect((await w.sam.get('/admin/community/reports?status=open')).body).toEqual([])
    expect((await w.bob.put(`/community/reading-collections/${c.id}/publish`, {})).status).toBe(409)
  })

  it('trang bị gỡ trong một bộ công khai thì người khác không thấy trang đó; báo cáo bài riêng tư → 404', async () => {
    const { c, p1, loose } = await bobLibrary()
    await w.bob.put(`/community/reading-collections/${c.id}/publish`, { include_content: true })
    await w.sam.post(`/admin/community/readings/${p1.id}/hide`)
    const view = (await w.alice.get(`/community/reading-collections/${c.id}`)).body
    expect(view.readings.map((r) => r.content)).toEqual(['Page two.'])
    expect(
      (await w.alice.post('/community/reports', { target_type: 'reading', target_id: loose.id, reason: 'x' })).status,
    ).toBe(404)
  })
})
