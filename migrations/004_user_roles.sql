-- ============================================================
-- 004 — vai trò toàn hệ thống + khoá tài khoản.
--
-- Trước đây chỉ có cờ `is_super_admin`. Giờ tách thành 3 cấp trong cột `role`:
--   • user        — người dùng thường (mặc định).
--   • admin       — quản lý MỌI nhóm và nội dung nhóm (việc trước đây super admin làm).
--   • super_admin — như admin, thêm quyền quản lý tài khoản: bổ nhiệm/gỡ admin, khoá/mở khoá,
--                   xoá tài khoản. Chỉ gán được bằng SQL thủ công (không ai tự phong qua app).
-- Vai trò "trưởng nhóm" theo từng nhóm (group_members.role) KHÔNG đổi.
--
-- Người đang có is_super_admin = true được chuyển thành super_admin; cột cũ bị xoá.
-- `disabled_at` khác null = tài khoản bị khoá (không đăng nhập, không gọi API được).
-- ============================================================
alter table users
  add column role text not null default 'user',
  add column disabled_at timestamptz,
  add constraint users_role_check check (role in ('user', 'admin', 'super_admin'));

update users set role = 'super_admin' where is_super_admin;

alter table users drop column is_super_admin;
