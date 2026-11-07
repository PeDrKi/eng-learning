import { assertWithinQuota } from '../../lib/quotas.js'
import { badRequest, notFound } from '../../lib/httpError.js'
import { canAddWordToDeck, canManageDeck } from '../access/permissions.js'
import { createDecksService, findVisibleDeck } from '../decks/decks.service.js'

// Bộ bài đọc (migration 031) — sổ tay CÁ NHÂN như bài đọc: không phải của mình thì coi như không tồn tại.
// Mỗi bộ gắn với một chủ đề từ vựng: tạo bộ mà không chọn chủ đề → tự tạo chủ đề cá nhân cùng tên.
export function createReadingCollectionsService({ pool, quotas }) {
  const decks = createDecksService({ pool, quotas })

  const notFoundCollection = () => notFound('Không tìm thấy bộ bài đọc.')

  // Chủ đề gắn với bộ phải là chủ đề mình THÊM TỪ được (của mình, hoặc của nhóm mình là thành viên) —
  // không gắn được chủ đề cộng đồng chỉ "lưu vào thư viện".
  async function assertUsableDeck(ctx, deckId) {
    const deck = await findVisibleDeck(pool, deckId, ctx)
    if (!deck || !canAddWordToDeck(deck, ctx)) {
      throw badRequest('deck_not_found', 'Chủ đề không tồn tại hoặc bạn không thêm từ vào đó được.')
    }
    return deck
  }

  async function list({ userId }) {
    const { rows } = await pool.query(
      `select c.*, d.name as deck_name,
              (select count(*)::int from readings r where r.collection_id = c.id) as reading_count
         from reading_collections c
         left join decks d on d.id = c.deck_id
        where c.user_id = $1
        order by c.created_at, c.id`,
      [userId],
    )
    return rows
  }

  async function getOwn(userId, id) {
    const { rows } = await pool.query('select * from reading_collections where id = $1 and user_id = $2', [id, userId])
    if (!rows[0]) throw notFoundCollection()
    return rows[0]
  }

  async function withDeckName(row) {
    if (!row.deck_id) return { ...row, deck_name: null }
    const { rows } = await pool.query('select name from decks where id = $1', [row.deck_id])
    return { ...row, deck_name: rows[0]?.name ?? null }
  }

  async function create(ctx, { name, description, deck_id }) {
    const { userId } = ctx
    await assertWithinQuota(pool, {
      table: 'reading_collections',
      userId,
      max: quotas.readingCollections,
      what: 'bộ bài đọc',
    })
    let deck
    let createdDeck = false
    if (deck_id) deck = await assertUsableDeck(ctx, deck_id)
    else {
      deck = await decks.create(ctx, { name })
      createdDeck = true
    }
    try {
      const { rows } = await pool.query(
        `insert into reading_collections (user_id, name, description, deck_id)
         values ($1, $2, $3, $4) returning *`,
        [userId, name, description, deck.id],
      )
      // `deck`: chủ đề vừa tạo kèm bộ (chỉ khi tạo mới) — FE đưa ngay vào danh sách chủ đề.
      return { ...rows[0], deck_name: deck.name, reading_count: 0, ...(createdDeck ? { deck } : {}) }
    } catch (err) {
      // Không để lại chủ đề "mồ côi" nếu tạo bộ thất bại.
      if (createdDeck) await pool.query('delete from decks where id = $1', [deck.id])
      throw err
    }
  }

  async function update(ctx, id, patch) {
    const { userId } = ctx
    const current = await getOwn(userId, id)
    if (patch.deck_id) await assertUsableDeck(ctx, patch.deck_id)

    // Đổi tên bộ → đổi tên chủ đề đi kèm nếu chủ đề VẪN mang tên cũ (người học chưa tự đặt tên khác)
    // và mình có quyền sửa chủ đề đó.
    if (patch.name !== undefined && patch.name !== current.name && current.deck_id && patch.deck_id === undefined) {
      const deck = await findVisibleDeck(pool, current.deck_id, ctx)
      if (deck && deck.name === current.name && canManageDeck(deck, ctx)) {
        await pool.query('update decks set name = $2 where id = $1', [deck.id, patch.name])
      }
    }

    const deckGiven = patch.deck_id !== undefined
    const { rows } = await pool.query(
      `update reading_collections
          set name = coalesce($3, name),
              description = coalesce($4, description),
              deck_id = case when $5 then $6::uuid else deck_id end,
              updated_at = now()
        where id = $1 and user_id = $2
        returning *`,
      [id, userId, patch.name ?? null, patch.description ?? null, deckGiven, patch.deck_id ?? null],
    )
    if (!rows[0]) throw notFoundCollection()
    const { rows: count } = await pool.query('select count(*)::int as n from readings where collection_id = $1', [id])
    return { ...(await withDeckName(rows[0])), reading_count: count[0].n }
  }

  // Xoá bộ: chủ đề và từ GIỮ nguyên. Bài đọc về "Ghi chú" — trừ khi `deleteReadings`, khi đó xoá luôn.
  async function remove({ userId }, id, { deleteReadings = false } = {}) {
    await getOwn(userId, id)
    const client = await pool.connect()
    try {
      await client.query('begin')
      if (deleteReadings) {
        await client.query('delete from readings where collection_id = $1 and user_id = $2', [id, userId])
      }
      await client.query('delete from reading_collections where id = $1 and user_id = $2', [id, userId])
      await client.query('commit')
    } catch (err) {
      await client.query('rollback')
      throw err
    } finally {
      client.release()
    }
  }

  return { list, create, update, remove }
}
