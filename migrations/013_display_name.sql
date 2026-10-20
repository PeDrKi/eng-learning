-- ============================================================
-- 013 — tên hiển thị của tài khoản.
--
-- Trước đây giao diện chỉ hiện email. `display_name` là tên người dùng tự đặt (không bắt buộc,
-- không cần duy nhất, KHÔNG dùng để đăng nhập — đăng nhập vẫn bằng email). Null = chưa đặt,
-- giao diện hiện email như cũ. BE luôn cắt khoảng trắng 2 đầu và đổi chuỗi rỗng thành null.
-- ============================================================
alter table users
  add column display_name text,
  add constraint users_display_name_length check (display_name is null or char_length(display_name) between 1 and 40);
