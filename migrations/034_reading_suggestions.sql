-- ============================================================
-- 034 — Chia sẻ BÀI ĐỌC (đợt 2): người xem gửi ĐỀ XUẤT SỬA cho bài đọc công khai, chủ bài duyệt.
-- CHỈ THÊM bảng mới và nới ràng buộc thông báo; không sửa dữ liệu cũ.
--
-- kind:
--   add_note    — thêm ghi chú: `proposed` = { type, text, meaning, explanation, example }
--   edit_note   — sửa ghi chú `note_id`: `base` = ghi chú lúc đề xuất, `proposed` = các trường muốn đổi
--   translation — bản dịch cho đoạn thứ `paragraph` (từ 0): `base` = { text } bản dịch lúc đề xuất,
--                 `proposed` = { text }
--   typo        — sửa lỗi chính tả trong NGUYÊN VĂN, đoạn `paragraph`: `base` = { text } đoạn lúc đề xuất,
--                 `proposed` = { find, replace }
-- Trạng thái: pending → accepted | rejected (chủ bài duyệt, có thể kèm ghi chú), hoặc stale (ghi chú /
-- đoạn không còn). `base` giúp phát hiện XUNG ĐỘT (bài đã đổi sau khi đề xuất) → cảnh báo trước khi ghi đè.
-- collection_id: đề xuất gửi lúc xem qua BỘ nào (để thông báo mở đúng chỗ); null = xem bài lẻ.
-- ============================================================
create table if not exists reading_suggestions (
  id uuid primary key default gen_random_uuid(),
  reading_id uuid not null references readings(id) on delete cascade,
  collection_id uuid references reading_collections(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  note_id text,
  paragraph int,
  base jsonb,
  proposed jsonb not null,
  reason text not null default '',
  status text not null default 'pending',
  review_note text not null default '',
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint reading_suggestions_kind_check check (kind in ('add_note', 'edit_note', 'translation', 'typo')),
  constraint reading_suggestions_status_check check (status in ('pending', 'accepted', 'rejected', 'stale')),
  constraint reading_suggestions_reason_length check (char_length(reason) <= 1000),
  constraint reading_suggestions_note_length check (char_length(review_note) <= 1000)
);
create index if not exists reading_suggestions_reading_idx on reading_suggestions (reading_id, status, created_at);
create index if not exists reading_suggestions_user_idx on reading_suggestions (user_id, created_at desc);

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'comment', 'suggestion', 'suggestion_result', 'reading_comment', 'reading_suggestion', 'reading_suggestion_result'
));
