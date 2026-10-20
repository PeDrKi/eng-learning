import { forbidden } from '../lib/httpError.js'
import { loadAccessContext } from '../modules/access/accessContext.js'
import { isSuperAdmin } from '../lib/roles.js'

// Chạy sau requireAuth trên MỌI endpoint cần đăng nhập: nạp "ngữ cảnh quyền" của người gọi từ DB
// bằng ĐÚNG 1 truy vấn (vai trò toàn hệ thống, trạng thái khoá, vai trò trong từng nhóm) rồi gắn
// vào req.access — các service nhận ngữ cảnh này làm tham số đầu, không tự truy vấn lại.
// Đọc DB ở mỗi request (không tin vào JWT) để việc khoá tài khoản / đổi vai trò / mời ra khỏi
// nhóm có hiệu lực NGAY chứ không phải chờ access token hết hạn.
//   req.access = { userId, role, isSystemAdmin, roleByGroupId }   (xem access/accessContext.js)
//   req.user.role cũng được gắn cho tiện.
export function requireActiveUser(pool) {
  return async (req, _res, next) => {
    req.access = await loadAccessContext(pool, req.user.id) // ném 401 nếu tài khoản đã xoá, 403 nếu bị khoá
    req.user.role = req.access.role
    next()
  }
}

// Chỉ super admin (dùng sau requireActiveUser). Người khác nhận 403.
export function requireSuperAdmin(req, _res, next) {
  next(isSuperAdmin(req.user.role) ? undefined : forbidden('Chỉ super admin mới dùng được chức năng này.'))
}
