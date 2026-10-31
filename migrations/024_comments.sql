-- ============================================================
-- 024 — CỘNG ĐỒNG (giai đoạn 2): nhận xét cho chủ đề công khai và cho từng từ trong đó.
--
-- word_id null = nhận xét chung cho cả chủ đề. Xoá MỀM (deleted_at, deleted_by): nhận xét bị xoá
-- không hiện nữa nhưng vẫn còn trong DB để quản trị viên xem lại khi có báo cáo vi phạm (giai đoạn 4).
-- Từ hoặc chủ đề bị xoá thật → nhận xét đi theo (cascade); tài khoản bị xoá → nhận xét của họ cũng vậy.
-- ============================================================
create table if not exists comments (
  id uuid primary key default gen_random_uuid(),
  deck_id uuid not null references decks(id) on delete cascade,
  word_id uuid references words(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references users(id) on delete set null,
  constraint comments_body_length check (char_length(body) between 1 and 1000)
);
create index if not exists comments_deck_created_idx on comments (deck_id, created_at) where deleted_at is null;
create index if not exists comments_word_idx on comments (word_id) where word_id is not null;
