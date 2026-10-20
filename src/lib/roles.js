// Vai trò toàn hệ thống (cột users.role). Khác với vai trò trong TỪNG nhóm
// (group_members.role: trưởng nhóm 'admin' / thành viên 'member').
export const ROLES = ['user', 'admin', 'super_admin']

// Admin và super admin đều quản lý được mọi nhóm + nội dung nhóm.
export const isSystemAdmin = (role) => role === 'admin' || role === 'super_admin'
// Chỉ super admin quản lý tài khoản người dùng.
export const isSuperAdmin = (role) => role === 'super_admin'
