-- ============================================================
-- 026 — CỘNG ĐỒNG (giai đoạn 4): báo cáo vi phạm, kiểm duyệt, thông báo.
--
-- reports: người dùng báo cáo 1 chủ đề / nhận xét / đề xuất. Super admin xem và xử lý.
-- decks.hidden_at: super admin GỠ chủ đề khỏi cộng đồng (ẩn với mọi người trừ chủ sở hữu, kể cả
--   người đã lưu; chủ sở hữu không tự công khai lại được cho tới khi được bỏ ẩn).
-- comments: dùng lại deleted_at/deleted_by của migration 024 để ẩn; bỏ ẩn = xoá 2 giá trị đó.
-- users.community_blocked_at: chặn 1 người khỏi MỌI thao tác cộng đồng (chia sẻ, nhận xét, đề xuất,
--   báo cáo) — vẫn học bình thường.
-- notifications: thông báo trong app (số chưa đọc ở mục Khám phá). `pushed_at` đánh dấu lần đã gửi
--   Web Push, để gom: mỗi người tối đa 1 thông báo đẩy về cộng đồng mỗi 15 phút.
-- ============================================================
create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  reason text not null default '',
  status text not null default 'open',
  resolved_by uuid references users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reports_target_type_check check (target_type in ('deck', 'comment', 'suggestion')),
  constraint reports_status_check check (status in ('open', 'resolved', 'dismissed')),
  constraint reports_reason_length check (char_length(reason) <= 1000)
);
-- Một người chỉ có 1 báo cáo ĐANG MỞ cho cùng 1 nội dung.
create unique index if not exists reports_open_unique on reports (reporter_id, target_type, target_id)
  where status = 'open';
create index if not exists reports_status_created_idx on reports (status, created_at);

alter table decks
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references users(id) on delete set null;

alter table users add column if not exists community_blocked_at timestamptz;

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  type text not null,
  deck_id uuid references decks(id) on delete cascade,
  actor_id uuid references users(id) on delete set null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  constraint notifications_type_check check (type in ('comment', 'suggestion', 'suggestion_result'))
);
create index if not exists notifications_user_created_idx on notifications (user_id, created_at desc);
create index if not exists notifications_user_unread_idx on notifications (user_id) where read_at is null;
