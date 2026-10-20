-- ============================================================
-- 017 — xác nhận email khi đăng ký.
--
-- `email_verified_at`: lúc chủ email bấm link xác nhận (hoặc đăng nhập bằng Google / đặt lại
-- mật khẩu qua email — đều chứng minh nắm hộp thư). Null = chưa xác nhận. Khi bật
-- EMAIL_VERIFICATION=required, tài khoản chưa xác nhận không đăng nhập được.
-- Tài khoản ĐÃ CÓ trước bản này được coi như đã xác nhận (không bắt người dùng cũ làm lại).
--
-- email_verification_tokens: mỗi link xác nhận 1 dòng, chỉ lưu HASH của token (như
-- password_reset_tokens). `password_hash`: mật khẩu chọn ở lần đăng ký sinh ra link này — áp
-- vào tài khoản khi bấm link. Nhờ vậy nếu ai đó đăng ký trước bằng email của bạn rồi bạn đăng
-- ký lại, bấm link trong email CỦA BẠN sẽ kích hoạt mật khẩu CỦA BẠN chứ không phải của họ.
-- Null = giữ mật khẩu hiện có (link gửi lại).
-- ============================================================
alter table users add column email_verified_at timestamptz;
update users set email_verified_at = created_at;

create table email_verification_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  password_hash text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index email_verification_tokens_user_idx on email_verification_tokens (user_id);
