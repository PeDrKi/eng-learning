-- ============================================================
-- 008 — nhắc học hằng ngày (thông báo đẩy).
--
-- Lịch ôn SRS chỉ có tác dụng nếu người học QUAY LẠI đúng ngày. Chuỗi ngày học đã có từ trước,
-- nhưng nó chỉ thưởng cho người vốn đã nhớ mở app; thứ thật sự giữ thói quen là một lời nhắc
-- đúng giờ. Bảng + cột dưới đây là phần lưu trữ cho việc đó.
--
-- Nguyên tắc (xem src/jobs/sendReminders.js): CHỈ nhắc khi hôm nay người đó CHƯA học và CÓ thẻ
-- đến hạn. Nhắc người đã học xong, hoặc nhắc khi không có gì để ôn, là làm phiền chứ không giúp —
-- và là cách nhanh nhất để người dùng tắt thông báo vĩnh viễn.
-- ============================================================

-- Mỗi thiết bị/trình duyệt một đăng ký. `endpoint` là định danh do trình duyệt cấp, duy nhất toàn
-- cục → unique để đăng ký lại trên cùng máy không tạo dòng rác.
create table if not exists push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists push_subscriptions_user_idx on push_subscriptions (user_id);

alter table user_settings
  add column if not exists reminder_enabled boolean not null default false,
  -- Giờ địa phương muốn được nhắc (0–23). 20h là mặc định: buổi tối, sau bữa cơm.
  add column if not exists reminder_hour int not null default 20,
  -- Múi giờ IANA của người học — giờ nhắc phải tính theo giờ CỦA HỌ, không theo giờ máy chủ.
  add column if not exists reminder_tz text not null default 'Asia/Ho_Chi_Minh',
  -- Lần nhắc gần nhất, để một ngày không bị nhắc hai lần (việc gửi chạy mỗi giờ).
  add column if not exists reminder_sent_at timestamptz;
