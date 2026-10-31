import { HttpError } from '../../lib/httpError.js'

// Kiểm tra trước mọi thao tác VIẾT ở cộng đồng (chia sẻ, nhận xét, đề xuất, báo cáo):
//   - bị super admin chặn khỏi cộng đồng (users.community_blocked_at, migration 026) → 403
//   - bật COMMUNITY_REQUIRE_VERIFIED_EMAIL mà chưa xác nhận email → 403
// Học (lưu vào thư viện, sao chép, ôn) vẫn được dù bị chặn.
export async function assertCommunityAllowed(db, userId, { requireVerifiedEmail = false } = {}) {
  const { rows } = await db.query('select community_blocked_at, email_verified_at from users where id = $1', [userId])
  const user = rows[0]
  if (user?.community_blocked_at) {
    throw new HttpError(403, 'community_blocked', 'Tài khoản của bạn đã bị tạm khoá các tính năng cộng đồng.')
  }
  if (requireVerifiedEmail && !user?.email_verified_at) {
    throw new HttpError(
      403,
      'email_not_verified',
      'Hãy xác nhận email của bạn trước khi tham gia cộng đồng (xem mục Tài khoản).',
    )
  }
}
