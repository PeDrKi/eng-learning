import { withTransaction } from '../../db/pool.js'
import { badRequest, conflict, forbidden, notFound } from '../../lib/httpError.js'
import { assertCommunityAllowed } from './guard.js'
import { assertWithinQuota } from '../../lib/quotas.js'
import { sqlPublicIdentity } from '../../lib/publicName.js'

// Cộng đồng — giai đoạn 1: công khai chủ đề cá nhân, trang Khám phá, "Lưu vào thư viện" (theo dõi:
// học thẳng chủ đề của người khác, thấy ngay chỉnh sửa của họ) và "Sao chép" (bản riêng, độc lập).
//
// Chỉ người ĐÃ ĐĂNG NHẬP xem được (router gắn sau requireUser). Chỉ hiện tên công khai của chủ sở
// hữu (lib/publicName.js), không bao giờ email. Chỉ chủ đề CÁ NHÂN được công khai (ràng buộc DB
// decks_public_personal_only) và chỉ chủ sở hữu bật/tắt được.

const deckNotFound = () => notFound('Không tìm thấy chủ đề công khai.')

// Cột trả ra cho một chủ đề công khai. $1 = người gọi (để biết `followed` / `mine`).
const DECK_COLUMNS = `d.id, d.name, d.color, d.description, d.is_public, d.published_at, (d.hidden_at is not null) as hidden,
       ${sqlPublicIdentity('owner')},
       (d.user_id = $1) as mine,
       exists (select 1 from deck_follows f where f.deck_id = d.id and f.user_id = $1) as followed,
       (select count(*)::int from words w where w.deck_id = d.id) as word_count,
       (select count(*)::int from deck_follows f where f.deck_id = d.id) as follower_count`

// Nội dung từ được chia sẻ — KHÔNG kèm tiến trình học hay id người dùng.
const WORD_COLUMNS = 'w.id, w.word, w.meaning, w.meaning_en, w.example, w.ipa, w.audio_url, w.pos, w.created_at'

export function createCommunityService({ pool, quotas, requireVerifiedEmail = false, notify = async () => {} }) {
  // Xem được: chủ đề đang công khai, hoặc mình đã lưu (kể cả khi chủ sở hữu đã tắt công khai mà
  // không thu hồi), hoặc của chính mình.
  async function findViewable(db, userId, deckId) {
    const { rows } = await db.query(
      `select ${DECK_COLUMNS}, d.user_id, d.group_id
         from decks d join users u on u.id = d.user_id
        where d.id = $2 and d.group_id is null
          and (d.user_id = $1
               or (d.hidden_at is null and (d.is_public
                   or exists (select 1 from deck_follows f where f.deck_id = d.id and f.user_id = $1))))`,
      [userId, deckId],
    )
    return rows[0] ?? null
  }

  async function listPublic({ userId }, { q } = {}) {
    const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null
    const { rows } = await pool.query(
      `select ${DECK_COLUMNS}
         from decks d join users u on u.id = d.user_id
        where d.is_public and d.hidden_at is null
          and ($2::text is null or d.name ilike $2 or d.description ilike $2 or u.display_name ilike $2)
        order by follower_count desc, d.published_at desc, d.id
        limit 100`,
      [userId, pattern],
    )
    return rows
  }

  async function getDeck({ userId }, deckId) {
    const deck = await findViewable(pool, userId, deckId)
    if (!deck) throw deckNotFound()
    const { rows: words } = await pool.query(
      `select ${WORD_COLUMNS},
              (select count(*)::int from comments c where c.word_id = w.id and c.deleted_at is null) as comment_count
         from words w where w.deck_id = $1 order by w.created_at desc, w.id`,
      [deckId],
    )
    const { rows: counts } = await pool.query(
      'select count(*)::int as n from comments where deck_id = $1 and word_id is null and deleted_at is null',
      [deckId],
    )
    const { user_id, group_id, ...publicDeck } = deck
    void user_id
    void group_id
    return { ...publicDeck, comment_count: counts[0].n, words }
  }

  // ---- Nhận xét (giai đoạn 2) ----
  // Xem/viết được ở chủ đề mình XEM được (đang công khai, của mình, hoặc đã lưu). word_id bỏ trống =
  // nhận xét chung cho cả chủ đề. Người viết và chủ chủ đề xoá được (super admin cũng vậy — kiểm duyệt).

  async function listComments(ctx, deckId, { word_id }) {
    const deck = await findViewable(pool, ctx.userId, deckId)
    if (!deck) throw deckNotFound()
    const { rows } = await pool.query(
      `select c.id, c.word_id, c.body, c.created_at, ${sqlPublicIdentity('author')},
              (c.user_id = $1) as mine,
              (c.user_id = $1 or $3 or $4) as can_delete
         from comments c join users u on u.id = c.user_id
        where c.deck_id = $2 and c.deleted_at is null
          and (case when $5::uuid is null then c.word_id is null else c.word_id = $5 end)
        order by c.created_at asc, c.id`,
      [ctx.userId, deckId, deck.mine, ctx.isSystemAdmin, word_id ?? null],
    )
    return rows
  }

  async function addComment(ctx, deckId, { body, word_id }) {
    const { userId } = ctx
    const deck = await findViewable(pool, userId, deckId)
    if (!deck) throw deckNotFound()
    await assertCommunityAllowed(pool, userId, { requireVerifiedEmail })
    if (word_id) {
      const { rowCount } = await pool.query('select 1 from words where id = $1 and deck_id = $2', [word_id, deckId])
      if (!rowCount) throw badRequest('word_not_in_deck', 'Từ này không thuộc chủ đề.')
    }
    const { rows } = await pool.query(
      'insert into comments (deck_id, word_id, user_id, body) values ($1, $2, $3, $4) returning id',
      [deckId, word_id ?? null, userId, body],
    )
    await notify(deck.user_id, {
      type: 'comment',
      deckId,
      actorId: userId,
      payload: { deck_name: deck.name, comment_id: rows[0].id, word_id: word_id ?? null },
    })
    const list = await listComments(ctx, deckId, { word_id })
    return list.find((c) => c.id === rows[0].id)
  }

  async function deleteComment(ctx, commentId) {
    const { rows } = await pool.query(
      `select c.user_id, d.user_id as deck_owner
         from comments c join decks d on d.id = c.deck_id
        where c.id = $1 and c.deleted_at is null`,
      [commentId],
    )
    const found = rows[0]
    if (!found) throw notFound('Không tìm thấy nhận xét.')
    const allowed = found.user_id === ctx.userId || found.deck_owner === ctx.userId || ctx.isSystemAdmin
    if (!allowed) throw forbidden('Chỉ người viết hoặc chủ chủ đề mới xoá được nhận xét này.')
    await pool.query('update comments set deleted_at = now(), deleted_by = $2 where id = $1', [commentId, ctx.userId])
  }

  async function follow(ctx, deckId) {
    const { userId } = ctx
    const deck = await findViewable(pool, userId, deckId)
    if (!deck || !deck.is_public) throw deckNotFound()
    if (deck.mine) throw badRequest('own_deck', 'Đây là chủ đề của bạn — không cần lưu vào thư viện.')
    if (!deck.followed) {
      await assertWithinQuota(pool, {
        table: 'deck_follows',
        userId,
        max: quotas.follows,
        what: 'chủ đề đã lưu',
      })
      await pool.query('insert into deck_follows (user_id, deck_id) values ($1, $2) on conflict do nothing', [
        userId,
        deckId,
      ])
    }
    return findViewable(pool, userId, deckId).then(stripOwner)
  }

  async function unfollow({ userId }, deckId) {
    await pool.query('delete from deck_follows where user_id = $1 and deck_id = $2', [userId, deckId])
  }

  // Sao chép thành chủ đề CÁ NHÂN mới của mình: bản độc lập, không nhận chỉnh sửa về sau của chủ
  // sở hữu (khác "Lưu vào thư viện"). Tiến trình học bắt đầu từ đầu (trigger handle_new_word).
  async function copy(ctx, deckId) {
    const { userId } = ctx
    const deck = await findViewable(pool, userId, deckId)
    if (!deck) throw deckNotFound()
    if (deck.mine) throw badRequest('own_deck', 'Đây là chủ đề của bạn — không cần sao chép.')
    return withTransaction(pool, async (client) => {
      await assertWithinQuota(client, { table: 'decks', userId, max: quotas.decks, what: 'chủ đề con' })
      await assertWithinQuota(client, {
        table: 'words',
        userId,
        adding: deck.word_count,
        max: quotas.words,
        what: 'từ',
      })
      const { rows } = await client.query('insert into decks (user_id, name, color) values ($1, $2, $3) returning *', [
        userId,
        deck.name,
        deck.color,
      ])
      const newDeck = rows[0]
      const { rowCount } = await client.query(
        `insert into words (user_id, deck_id, word, meaning, meaning_en, example, ipa, audio_url, tags, pos)
         select $1, $2, word, meaning, meaning_en, example, ipa, audio_url, tags, pos
           from words where deck_id = $3
          order by created_at asc, id`,
        [userId, newDeck.id, deckId],
      )
      return { deck: newDeck, words_copied: rowCount }
    })
  }

  async function findOwnPersonal(userId, deckId) {
    const { rows } = await pool.query('select * from decks where id = $1 and user_id = $2', [deckId, userId])
    const deck = rows[0]
    if (!deck) throw notFound('Không tìm thấy chủ đề con.')
    if (deck.group_id) {
      throw badRequest(
        'group_deck_not_publishable',
        'Chỉ chủ đề cá nhân mới công khai được — chủ đề nhóm thuộc về nhóm.',
      )
    }
    return deck
  }

  async function publish({ userId }, deckId, { description }) {
    const deck = await findOwnPersonal(userId, deckId)
    await assertCommunityAllowed(pool, userId)
    if (deck.hidden_at) {
      throw conflict('deck_hidden', 'Chủ đề này đã bị quản trị viên gỡ khỏi cộng đồng — không công khai lại được.')
    }
    await pool.query(
      `update decks set is_public = true, description = $2, published_at = coalesce(published_at, now())
        where id = $1`,
      [deckId, description],
    )
    return findViewable(pool, userId, deckId).then(stripOwner)
  }

  async function unpublish({ userId }, deckId, { revoke_followers }) {
    await findOwnPersonal(userId, deckId)
    return withTransaction(pool, async (client) => {
      await client.query('update decks set is_public = false, published_at = null where id = $1', [deckId])
      let revoked = 0
      if (revoke_followers) {
        ;({ rowCount: revoked } = await client.query('delete from deck_follows where deck_id = $1', [deckId]))
      }
      return { revoked }
    })
  }

  // ---- Thông báo (giai đoạn 4) ----
  async function listNotifications({ userId }) {
    const { rows } = await pool.query(
      `select n.id, n.type, n.deck_id, n.payload, n.created_at, n.read_at, ${sqlPublicIdentity('actor')}
         from notifications n left join users u on u.id = n.actor_id
        where n.user_id = $1
        order by n.created_at desc
        limit 50`,
      [userId],
    )
    const { rows: unread } = await pool.query(
      'select count(*)::int as n from notifications where user_id = $1 and read_at is null',
      [userId],
    )
    return { unread: unread[0].n, items: rows }
  }

  async function markNotificationsRead({ userId }) {
    await pool.query('update notifications set read_at = now() where user_id = $1 and read_at is null', [userId])
  }

  // ---- Báo cáo vi phạm ----
  // Kiểm tra nội dung còn tồn tại và người báo cáo XEM được nó; gửi lại khi đang có báo cáo mở cho
  // cùng nội dung thì coi như đã gửi (không tạo bản trùng).
  async function report(ctx, { target_type, target_id, reason }) {
    const { userId } = ctx
    await assertCommunityAllowed(pool, userId, { requireVerifiedEmail })
    let deckId = target_id
    if (target_type === 'comment') {
      const { rows } = await pool.query('select deck_id from comments where id = $1 and deleted_at is null', [
        target_id,
      ])
      deckId = rows[0]?.deck_id
    } else if (target_type === 'suggestion') {
      const { rows } = await pool.query('select deck_id from edit_suggestions where id = $1', [target_id])
      deckId = rows[0]?.deck_id
    }
    if (!deckId || !(await findViewable(pool, userId, deckId))) throw notFound('Không tìm thấy nội dung cần báo cáo.')
    await pool.query(
      `insert into reports (reporter_id, target_type, target_id, reason) values ($1, $2, $3, $4)
       on conflict (reporter_id, target_type, target_id) where status = 'open' do nothing`,
      [userId, target_type, target_id, reason],
    )
    return { ok: true }
  }

  return {
    listNotifications,
    markNotificationsRead,
    report,
    listPublic,
    getDeck,
    follow,
    unfollow,
    copy,
    publish,
    unpublish,
    listComments,
    addComment,
    deleteComment,
  }
}

function stripOwner(deck) {
  if (!deck) return deck
  const { user_id, group_id, ...rest } = deck
  void user_id
  void group_id
  return rest
}
