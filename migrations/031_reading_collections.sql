-- ============================================================
-- 031 — BỘ BÀI ĐỌC: gom các bài đọc (trang sách, mẩu tin…) thành một bộ (CHỈ THÊM, không sửa dữ liệu cũ).
--
-- reading_collections — sổ tay CÁ NHÂN như bài đọc. Mỗi bộ gắn với MỘT chủ đề từ vựng (`deck_id`),
-- tạo ngay khi tạo bộ (cùng tên) hoặc chọn chủ đề có sẵn: từ / câu thông dụng lưu từ bài trong bộ đi
-- thẳng vào chủ đề này. Xoá chủ đề thì bộ chỉ mất liên kết (set null), không mất bài.
--
-- readings:
--   collection_id — bộ chứa bài; trống = "Ghi chú" (bài lẻ). Xoá bộ thì bài về "Ghi chú" (set null);
--                   muốn xoá luôn bài thì API xoá bài trước rồi mới xoá bộ.
--   position      — thứ tự trang trong bộ (nhỏ trước). Bài cũ đều 0.
-- ============================================================
create table if not exists reading_collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  name text not null check (char_length(name) between 1 and 100),
  description text not null default '' check (char_length(description) <= 500),
  deck_id uuid references decks(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists reading_collections_user_idx on reading_collections (user_id, created_at);

alter table readings
  add column if not exists collection_id uuid references reading_collections(id) on delete set null,
  add column if not exists position int not null default 0;
create index if not exists readings_collection_idx on readings (collection_id, position);
