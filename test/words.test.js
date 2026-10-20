import { beforeEach, describe, expect, it } from 'vitest'
import { loadAccessContext } from '../src/modules/access/accessContext.js'
import { canViewWord } from '../src/modules/access/permissions.js'
import { buildWorld, setupTestApp } from './helpers.js'

const { app, pool } = setupTestApp()
let w
beforeEach(async () => {
  w = await buildWorld(app, pool)
})

const texts = (res) => res.body.map((x) => x.word).toSorted()
const progressCount = async (wordId) =>
  (await pool.query('select count(*)::int as n from word_progress where word_id = $1', [wordId])).rows[0].n

describe('GET /words', () => {
  it('thấy từ của mình + mọi từ trong chủ đề của nhóm mình tham gia', async () => {
    expect(texts(await w.alice.get('/words'))).toEqual(['apple', 'group-by-alice', 'group-by-bob'])
    expect(texts(await w.bob.get('/words'))).toEqual(['banana', 'group-by-alice', 'group-by-bob', 'loose'])
    expect(texts(await w.carol.get('/words'))).toEqual(['cherry'])
    expect(texts(await w.sam.get('/words'))).toEqual(['group-by-alice', 'group-by-bob'])
  })

  it('rời nhóm: vẫn thấy từ mình đã thêm, không còn thấy từ người khác trong nhóm', async () => {
    await pool.query('delete from group_members where user_id = $1', [w.bob.id])
    expect(texts(await w.bob.get('/words'))).toEqual(['banana', 'group-by-bob', 'loose'])
  })

  it('trả kèm tiến trình học của CHÍNH MÌNH, không cần gọi thêm GET /progress', async () => {
    const mine = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    await pool.query(
      `update word_progress set repetitions = 5, interval_days = 12, quiz_wrong = 2
        where word_id = $1 and user_id = $2`,
      [mine.id, w.alice.id],
    )
    const again = (await w.alice.get('/words')).body.find((x) => x.word === 'apple')
    expect(again).toMatchObject({ repetitions: 5, interval_days: 12, quiz_wrong: 2 })
    expect(again.id).toBe(mine.id) // id của TỪ, không bị dòng word_progress đè lên
    expect(again.user_id).toBe(w.alice.id)

    // Từ của người khác (thấy qua chủ đề chung): không có tiến trình của mình → null, frontend
    // tự điền mặc định. Giống hệt khi còn gọi GET /progress riêng.
    const other = (await w.alice.get('/words')).body.find((x) => x.word === 'group-by-bob')
    expect(other.repetitions).toBeNull()
  })

  it('bản phân trang cũng kèm tiến trình, và không lộ cột nội bộ cursor_key', async () => {
    const page = (await w.alice.get('/words?limit=2')).body
    expect(page.items).toHaveLength(2)
    for (const item of page.items) {
      expect(item).toHaveProperty('due_at')
      expect(item).toHaveProperty('quiz_correct')
      expect(item).not.toHaveProperty('cursor_key')
    }
  })

  it('lọc bằng SQL khớp với luật canViewWord() cho mọi người dùng', async () => {
    const { rows } = await pool.query(
      'select row_to_json(w.*) as word, row_to_json(d.*) as deck from words w left join decks d on d.id = w.deck_id',
    )
    for (const user of [w.alice, w.bob, w.carol, w.sam]) {
      const ctx = await loadAccessContext(pool, user.id)
      const expected = rows.filter((r) => canViewWord(r.word, r.deck, ctx)).map((r) => r.word.id)
      const actual = (await user.get('/words')).body.map((x) => x.id)
      expect(actual.toSorted()).toEqual(expected.toSorted())
    }
  })
})

describe('POST /words', () => {
  it('thêm từ: làm sạch dữ liệu, tự tạo dòng tiến trình học (word_progress)', async () => {
    const res = await w.carol.post('/words', {
      word: '  dog ',
      meaning: 'con chó',
      tags: ['Khó nhớ', 'khó nhớ', '  ', 'thi cử'],
      user_id: w.alice.id, // bị bỏ qua
    })
    expect(res.status).toBe(201)
    expect(res.body).toMatchObject({
      word: 'dog',
      meaning: 'con chó',
      example: '',
      ipa: '',
      audio_url: '',
      tags: ['Khó nhớ', 'thi cử'],
      pos: [],
      deck_id: null,
      user_id: w.carol.id,
    })
    expect(await progressCount(res.body.id)).toBe(1)
  })

  it.each([
    ['bob vào chủ đề nhóm (thành viên)', 'bob', 'group', 201],
    ['sam vào chủ đề nhóm (super admin)', 'sam', 'group', 201],
    ['carol vào chủ đề nhóm (người ngoài)', 'carol', 'group', 400],
    ['bob vào chủ đề riêng của alice', 'bob', 'alice', 400],
    ['sam vào chủ đề riêng của alice', 'sam', 'alice', 400],
  ])('%s %s %s → %i', async (_label, who, deckKey, status) => {
    const res = await w[who].post('/words', { word: 'x', meaning: 'y', deck_id: w.decks[deckKey].id })
    expect(res.status).toBe(status)
    if (status === 400) expect(res.body.error.code).toBe('deck_not_found')
  })

  it('link phát âm chỉ nhận http(s) hoặc để trống', async () => {
    const add = (audio_url) => w.bob.post('/words', { word: 'x', meaning: 'y', audio_url })
    expect((await add('https://example.com/a.mp3')).status).toBe(201)
    expect((await add('')).status).toBe(201)
    for (const bad of ['javascript:alert(1)', 'data:audio/mp3;base64,AAAA', '//example.com/a.mp3', 'a.mp3']) {
      const res = await add(bad)
      expect(res.status).toBe(400)
      expect(res.body.error.message).toBe('Link phát âm phải bắt đầu bằng http:// hoặc https://.')
    }
    const own = (await add('https://example.com/a.mp3')).body
    expect((await w.bob.patch(`/words/${own.id}`, { audio_url: 'javascript:alert(1)' })).status).toBe(400)
  })

  it('từ loại: nhận nhiều mã, bỏ trùng giữ thứ tự, từ chối mã lạ', async () => {
    const ok = await w.bob.post('/words', { word: 'fast', meaning: 'nhanh', pos: ['adjective', 'adverb', 'adjective'] })
    expect(ok.status).toBe(201)
    expect(ok.body.pos).toEqual(['adjective', 'adverb'])
    for (const bad of [['noun', 'thingy'], 'noun', ['Noun']]) {
      const res = await w.bob.post('/words', { word: 'x', meaning: 'y', pos: bad })
      expect(res.status).toBe(400)
    }
    const patched = await w.bob.patch(`/words/${ok.body.id}`, { pos: ['phrasal_verb'] })
    expect(patched.body.pos).toEqual(['phrasal_verb'])
    expect((await w.bob.patch(`/words/${ok.body.id}`, { pos: [] })).body.pos).toEqual([])
    expect((await w.bob.patch(`/words/${ok.body.id}`, { pos: ['verb', 'bad'] })).status).toBe(400)
  })

  it('DB cũng chặn mã từ loại lạ (phòng khi code bỏ sót kiểm tra)', async () => {
    await expect(
      pool.query(`update words set pos = '{bogus}' where id = $1`, [w.words.bobPersonal.id]),
    ).rejects.toMatchObject({ code: '23514' })
  })

  it('báo lỗi tiếng Việt khi thiếu từ/nghĩa', async () => {
    const res = await w.bob.post('/words', {})
    expect(res.status).toBe(400)
    expect(res.body.error.details.map((d) => d.message)).toEqual(['Vui lòng nhập từ.', 'Vui lòng nhập nghĩa.'])
  })
})

describe('POST /words/bulk', () => {
  it('thêm nhiều từ vào nhiều chủ đề, đúng thứ tự, mỗi từ có tiến trình học', async () => {
    const res = await w.bob.post('/words/bulk', {
      words: [
        { word: 'one', meaning: 'một', deck_id: w.decks.bob.id, tags: ['số'], pos: ['numeral', 'pronoun'] },
        { word: 'two', meaning: 'hai', deck_id: w.decks.group.id },
        { word: 'three', meaning: 'ba' },
      ],
    })
    expect(res.status).toBe(201)
    expect(res.body.map((x) => [x.word, x.deck_id, x.tags, x.pos])).toEqual([
      ['one', w.decks.bob.id, ['số'], ['numeral', 'pronoun']],
      ['two', w.decks.group.id, [], []],
      ['three', null, [], []],
    ])
    for (const x of res.body) expect(await progressCount(x.id)).toBe(1)
  })

  it('1 từ vào chủ đề không có quyền → từ chối CẢ LÔ, không thêm từ nào', async () => {
    const before = texts(await w.bob.get('/words'))
    const res = await w.bob.post('/words/bulk', {
      words: [
        { word: 'ok', meaning: 'ok', deck_id: w.decks.bob.id },
        { word: 'lậu', meaning: 'x', deck_id: w.decks.carol.id },
      ],
    })
    expect(res.status).toBe(400)
    expect(texts(await w.bob.get('/words'))).toEqual(before)
  })

  it('giới hạn 1000 từ mỗi lần', async () => {
    const words = Array.from({ length: 1001 }, (_, i) => ({ word: `w${i}`, meaning: 'm' }))
    expect((await w.bob.post('/words/bulk', { words })).status).toBe(400)
  })
})

describe('PATCH /words/:id — sửa nội dung', () => {
  const edit = (user, word) => user.patch(`/words/${word.id}`, { meaning: 'nghĩa mới', tags: ['khó nhớ'] })

  it.each([
    ['bob sửa từ cá nhân của mình', 'bob', 'bobPersonal', 200],
    ['bob sửa từ CHÍNH MÌNH thêm vào chủ đề nhóm', 'bob', 'bobInGroup', 403],
    ['alice (trưởng nhóm) sửa từ bob thêm vào nhóm', 'alice', 'bobInGroup', 200],
    ['sam (super admin) sửa từ trong nhóm', 'sam', 'bobInGroup', 200],
    ['sam sửa từ cá nhân của alice', 'sam', 'alicePersonal', 404],
    ['carol sửa từ trong nhóm', 'carol', 'aliceInGroup', 404],
    ['bob sửa từ cá nhân của alice', 'bob', 'alicePersonal', 404],
  ])('%s %s %s → %i', async (_label, who, wordKey, status) => {
    const res = await edit(w[who], w.words[wordKey])
    expect(res.status).toBe(status)
    if (status === 200) expect(res.body).toMatchObject({ meaning: 'nghĩa mới', tags: ['khó nhớ'] })
  })

  it('chỉ đổi đúng các field gửi lên', async () => {
    const res = await w.bob.patch(`/words/${w.words.bobPersonal.id}`, { ipa: '/bəˈnɑːnə/' })
    expect(res.body).toMatchObject({ word: 'banana', meaning: 'nghĩa', ipa: '/bəˈnɑːnə/' })
  })

  it('không có field hợp lệ nào → 400', async () => {
    const res = await w.bob.patch(`/words/${w.words.bobPersonal.id}`, { due_at: '2030-01-01' })
    expect(res.status).toBe(400)
  })
})

describe('PATCH /words/:id — chuyển chủ đề', () => {
  const move = (user, word, deck) => user.patch(`/words/${word.id}`, { deck_id: deck ? deck.id : null })

  it('bob chuyển từ giữa chủ đề riêng của mình và "chưa phân loại"', async () => {
    const extra = (await w.bob.post('/decks', { name: 'Bob 2' })).body
    expect((await move(w.bob, w.words.bobPersonal, extra)).status).toBe(200)
    expect((await move(w.bob, w.words.bobPersonal, null)).status).toBe(200)
  })

  it('bob không tự đẩy từ cá nhân vào chủ đề nhóm', async () => {
    expect((await move(w.bob, w.words.bobPersonal, w.decks.group)).status).toBe(403)
  })

  it('bob không chuyển từ sang chủ đề riêng của người khác', async () => {
    const res = await move(w.bob, w.words.bobPersonal, w.decks.alice)
    expect(res.status).toBe(400)
    expect(res.body.error.code).toBe('deck_not_found')
  })

  it('alice đưa từ riêng của mình vào chủ đề nhóm → cả nhóm thấy', async () => {
    expect((await move(w.alice, w.words.alicePersonal, w.decks.group)).status).toBe(200)
    expect(texts(await w.bob.get('/words'))).toContain('apple')
  })

  it('alice không kéo từ của bob ra khỏi nhóm', async () => {
    expect((await move(w.alice, w.words.bobInGroup, null)).status).toBe(403)
    expect((await move(w.alice, w.words.bobInGroup, w.decks.alice)).status).toBe(403)
  })
})

describe('DELETE /words/:id', () => {
  it('xoá từ cá nhân → xoá luôn tiến trình học', async () => {
    const id = w.words.bobPersonal.id
    expect((await w.bob.del(`/words/${id}`)).status).toBe(204)
    expect(await progressCount(id)).toBe(0)
    expect((await w.bob.del(`/words/${id}`)).status).toBe(404)
  })

  it.each([
    ['bob xoá từ mình thêm vào nhóm', 'bob', 'bobInGroup', 403],
    ['alice xoá từ bob thêm vào nhóm', 'alice', 'bobInGroup', 204],
    ['carol xoá từ của bob', 'carol', 'bobPersonal', 404],
    ['sam xoá từ cá nhân của carol', 'sam', 'carolPersonal', 404],
  ])('%s %s %s → %i', async (_label, who, wordKey, status) => {
    expect((await w[who].del(`/words/${w.words[wordKey].id}`)).status).toBe(status)
  })
})
