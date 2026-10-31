-- ============================================================
-- 025 — CỘNG ĐỒNG (giai đoạn 3): đề xuất chỉnh sửa cho chủ đề công khai, chủ chủ đề duyệt.
--
-- Người khác KHÔNG sửa thẳng được từ của chủ đề công khai; họ gửi đề xuất:
--   edit   — sửa 1 từ: `base` = nội dung từ lúc đề xuất, `proposed` = các trường muốn đổi
--   add    — thêm từ mới: `proposed` = nội dung từ mới (word_id null)
--   delete — xoá 1 từ: `base` = nội dung từ lúc đề xuất, kèm lý do
-- Trạng thái: pending → accepted | rejected (chủ chủ đề duyệt, có thể kèm ghi chú), hoặc stale
-- (từ đã bị xoá / chuyển khỏi chủ đề trước khi duyệt — đề xuất hết ý nghĩa). `base` giúp phát
-- hiện XUNG ĐỘT: từ đã bị sửa sau khi người ta đề xuất → cảnh báo trước khi ghi đè.
-- ============================================================
create table if not exists edit_suggestions (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks(id) on delete cascade,
  word_id uuid references words(id) on delete set null,
  user_id uuid not null references users(id) on delete cascade,
  kind text not null,
  base jsonb,
  proposed jsonb,
  reason text not null default '',
  status text not null default 'pending',
  review_note text not null default '',
  reviewed_by uuid references users(id) on delete set null,
  reviewed_at timestamptz,
  applied_word_id uuid references words(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint edit_suggestions_kind_check check (kind in ('edit', 'add', 'delete')),
  constraint edit_suggestions_status_check check (status in ('pending', 'accepted', 'rejected', 'stale')),
  constraint edit_suggestions_reason_length check (char_length(reason) <= 1000),
  constraint edit_suggestions_note_length check (char_length(review_note) <= 1000)
);
create index if not exists edit_suggestions_deck_status_idx on edit_suggestions (deck_id, status, created_at);
create index if not exists edit_suggestions_user_idx on edit_suggestions (user_id, created_at desc);
