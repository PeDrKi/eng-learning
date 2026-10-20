-- ============================================================
-- 016 — đăng nhập bằng Google.
--
-- `google_sub` = mã tài khoản Google (claim `sub` của ID token) — cố định với mỗi tài khoản Google,
-- KHÁC email (email Google đổi được). Null = tài khoản chưa gắn Google.
-- `password_hash` thành không bắt buộc: tài khoản tạo bằng Google chưa có mật khẩu; người dùng có
-- thể tự đặt sau trong mục Tài khoản. Mỗi tài khoản phải còn ÍT NHẤT 1 cách đăng nhập.
-- ============================================================
alter table users
  add column google_sub text,
  alter column password_hash drop not null,
  add constraint users_has_login_method check (password_hash is not null or google_sub is not null);

create unique index users_google_sub_idx on users (google_sub) where google_sub is not null;
