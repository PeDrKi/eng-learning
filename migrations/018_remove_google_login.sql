-- ============================================================
-- 018 — gỡ đăng nhập bằng Google (thêm ở 016).
--
-- Bỏ cột google_sub. `password_hash` vẫn để cho phép null: nếu lỡ có tài khoản tạo bằng Google
-- (chưa có mật khẩu), tài khoản đó KHÔNG bị xoá — chủ tài khoản dùng "Quên mật khẩu" để đặt mật
-- khẩu rồi đăng nhập như thường. Tài khoản mới luôn có mật khẩu (đăng ký bằng email).
-- ============================================================
alter table users drop constraint users_has_login_method;
drop index users_google_sub_idx;
alter table users drop column google_sub;
