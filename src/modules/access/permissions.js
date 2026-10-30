// ============================================================
// Luật phân quyền chủ đề (decks) & từ vựng (words) — thay cho các policy RLS của bản Supabase.
//
// Đây là NGUỒN SỰ THẬT DUY NHẤT về quyền: mọi service phải hỏi qua các hàm ở đây, không tự
// viết điều kiện riêng. Các hàm đều THUẦN (không đụng DB) để test được từng luật một
// (test/permissions.test.js). Truy vấn danh sách (xem decks/words service) lọc bằng SQL
// tương đương — test tích hợp kiểm tra 2 nơi cho kết quả khớp nhau.
//
// ctx = { userId, role, isSystemAdmin, roleByGroupId: Map<group_id, 'admin' | 'member'> }
//   isSystemAdmin = vai trò toàn hệ thống là admin HOẶC super admin (lib/roles.js). Trong file
//   này 2 cấp đó có quyền như nhau; phần khác nhau (quản lý tài khoản) nằm ở module admin.
//
// Tóm tắt luật:
//   Chủ đề CÁ NHÂN (group_id null) — chỉ chủ sở hữu xem/sửa/xoá/thêm từ.
//   Chủ đề NHÓM — thành viên: xem + thêm từ; trưởng nhóm: thêm quyền tạo/sửa/xoá chủ đề và
//     sửa/xoá MỌI từ trong đó (kể cả từ người khác thêm); super admin: như trưởng nhóm ở
//     mọi nhóm.
//   Từ không thuộc chủ đề nào — luôn là từ cá nhân của người tạo.
//   Người tạo LUÔN xem được từ của mình, kể cả khi đã rời nhóm chứa chủ đề đó (giống RLS cũ).
//
// KHÁC với RLS cũ (cố ý, chặt hơn):
//   • Super admin KHÔNG còn xem/sửa được chủ đề & từ CÁ NHÂN của người khác. RLS cũ cho phép
//     (is_super_admin() nằm ngoài điều kiện group), khiến danh sách của super admin lẫn cả
//     dữ liệu cá nhân của mọi người. Quyền super admin giờ chỉ áp dụng cho nội dung NHÓM.
//   • Chuyển 1 từ sang chủ đề cá nhân chỉ được khi chủ đề đó là của chính mình (RLS cũ chỉ
//     kiểm tra "là chủ đề cá nhân", không kiểm tra của ai).
// ============================================================

const isOwner = (row, ctx) => row.user_id === ctx.userId
const isMember = (groupId, ctx) => ctx.isSystemAdmin || ctx.roleByGroupId.has(groupId)
const isAdmin = (groupId, ctx) => ctx.isSystemAdmin || ctx.roleByGroupId.get(groupId) === 'admin'

// ---- Chủ đề ----

export function canViewDeck(deck, ctx) {
  return deck.group_id ? isMember(deck.group_id, ctx) : isOwner(deck, ctx)
}

// Đổi tên/màu, xoá chủ đề.
export function canManageDeck(deck, ctx) {
  return deck.group_id ? isAdmin(deck.group_id, ctx) : isOwner(deck, ctx)
}

// Tạo chủ đề mới: cá nhân thì ai cũng được; của nhóm thì chỉ trưởng nhóm/super admin.
export function canCreateDeck(groupId, ctx) {
  return groupId ? isAdmin(groupId, ctx) : true
}

// ---- Từ vựng ----
// `deck` là chủ đề chứa từ (null nếu từ chưa phân loại).

export function canAddWordToDeck(deck, ctx) {
  if (!deck) return true
  return deck.group_id ? isMember(deck.group_id, ctx) : isOwner(deck, ctx)
}

export function canViewWord(word, deck, ctx) {
  if (isOwner(word, ctx)) return true
  return Boolean(deck?.group_id) && isMember(deck.group_id, ctx)
}

// Sửa nội dung, gắn/gỡ nhãn, xoá từ.
export function canManageWord(word, deck, ctx) {
  if (deck?.group_id) return isAdmin(deck.group_id, ctx)
  return isOwner(word, ctx)
}

// Chuyển từ sang chủ đề khác (hoặc bỏ phân loại khi targetDeck = null): phải có quyền quản
// lý từ ở chỗ cũ VÀ trạng thái sau khi chuyển vẫn nằm trong quyền quản lý của mình — tránh
// "đẩy" từ vào chỗ mình không quản được nữa.
export function canMoveWord(word, fromDeck, targetDeck, ctx) {
  if (!canManageWord(word, fromDeck, ctx)) return false
  // Bỏ phân loại = từ trở thành từ cá nhân của người tạo → chỉ chính người tạo được làm.
  if (!targetDeck) return isOwner(word, ctx)
  if (targetDeck.group_id) return isAdmin(targetDeck.group_id, ctx)
  return isOwner(targetDeck, ctx) && isOwner(word, ctx)
}

// ---- Collocation (giới từ cố định, mẫu động từ) ----
// Chia sẻ theo ĐÚNG luật của từ vựng (collocation nằm trong chủ đề như từ): xem được từ của mình
// và mọi collocation trong chủ đề nhóm mình tham gia; thành viên thêm được; trưởng nhóm sửa/xoá
// được mọi mục trong chủ đề nhóm. Câu giao tiếp (kind = 'phrase') thì KHÔNG theo luật này — vẫn
// là sổ tay cá nhân (phrases.service.js).
export const canViewCollocation = canViewWord
export const canAddCollocationToDeck = canAddWordToDeck
export const canManageCollocation = canManageWord
export const canMoveCollocation = canMoveWord

// ---- Nhóm học tập ----

// Xem nhóm (tên, danh sách chủ đề chung): thành viên hoặc super admin.
export function canViewGroup(groupId, ctx) {
  return isMember(groupId, ctx)
}

// Đổi tên, tạo lại mã mời, xem mã mời, xem toàn bộ thành viên + dashboard tiến độ, đổi vai
// trò thành viên.
export function canManageGroup(groupId, ctx) {
  return isAdmin(groupId, ctx)
}

// Rời nhóm (tự xoá mình) — mọi thành viên; mời người khác ra — trưởng nhóm/super admin.
export function canRemoveMember(groupId, targetUserId, ctx) {
  if (targetUserId === ctx.userId) return ctx.roleByGroupId.has(groupId)
  return isAdmin(groupId, ctx)
}
