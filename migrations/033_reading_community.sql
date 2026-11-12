-- ============================================================
-- 033 — Chia sẻ BÀI ĐỌC ra cộng đồng (đợt 1): công khai cả BỘ bài đọc hoặc TỪNG bài lẻ, xem chỉ đọc,
-- "Lưu vào thư viện", "Sao chép", nhận xét, báo cáo và kiểm duyệt. CHỈ THÊM cột / bảng, nới ràng buộc;
-- không sửa dữ liệu cũ (mọi bộ / bài hiện có vẫn là riêng tư).
--
-- reading_collections / readings:
--   is_public            — đang công khai. Bài nằm trong một bộ công khai thì xem được qua bộ đó.
--   published_at         — lúc công khai (thứ tự ở Khám phá).
--   include_translations — người chia sẻ có cho xem bản dịch tự viết của mình không (mặc định có).
--   include_content      — có cho xem NGUYÊN VĂN không. Mặc định KHÔNG (tránh chép nguyên văn sách / báo):
--                          người xem chỉ thấy ghi chú và bản dịch; nguyên văn ẩn thì cũng không tìm kiếm
--                          được và không đi theo khi sao chép.
--   hidden_at/hidden_by  — super admin gỡ khỏi cộng đồng (không công khai lại được).
-- reading_follows  — "Lưu vào thư viện": đúng MỘT trong (bộ, bài). Tắt công khai thì các lượt lưu bị xoá.
-- reading_comments — nhận xét cho cả bộ (chỉ collection_id), cho 1 trang trong bộ (cả hai), hoặc cho
--                    1 bài lẻ (chỉ reading_id). Xoá mềm như comments của chủ đề.
-- ============================================================
alter table reading_collections
  add column if not exists is_public boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists include_translations boolean not null default true,
  add column if not exists include_content boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references users(id) on delete set null;
create index if not exists reading_collections_public_idx on reading_collections (published_at desc) where is_public;

alter table readings
  add column if not exists is_public boolean not null default false,
  add column if not exists published_at timestamptz,
  add column if not exists include_translations boolean not null default true,
  add column if not exists include_content boolean not null default false,
  add column if not exists hidden_at timestamptz,
  add column if not exists hidden_by uuid references users(id) on delete set null;
create index if not exists readings_public_idx on readings (published_at desc) where is_public;

create table if not exists reading_follows (
  user_id uuid not null references users(id) on delete cascade,
  collection_id uuid references reading_collections(id) on delete cascade,
  reading_id uuid references readings(id) on delete cascade,
  created_at timestamptz not null default now(),
  constraint reading_follows_target_check check (num_nonnulls(collection_id, reading_id) = 1)
);
create unique index if not exists reading_follows_collection_unique on reading_follows (user_id, collection_id)
  where collection_id is not null;
create unique index if not exists reading_follows_reading_unique on reading_follows (user_id, reading_id)
  where reading_id is not null;

create table if not exists reading_comments (
  id uuid primary key default gen_random_uuid(),
  collection_id uuid references reading_collections(id) on delete cascade,
  reading_id uuid references readings(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  deleted_by uuid references users(id) on delete set null,
  constraint reading_comments_target_check check (num_nonnulls(collection_id, reading_id) >= 1),
  constraint reading_comments_body_length check (char_length(body) between 1 and 1000)
);
create index if not exists reading_comments_collection_idx on reading_comments (collection_id, created_at)
  where deleted_at is null;
create index if not exists reading_comments_reading_idx on reading_comments (reading_id, created_at)
  where deleted_at is null;

alter table reports drop constraint if exists reports_target_type_check;
alter table reports add constraint reports_target_type_check check (target_type in (
  'deck', 'comment', 'suggestion', 'reading_collection', 'reading', 'reading_comment'
));

alter table notifications drop constraint if exists notifications_type_check;
alter table notifications add constraint notifications_type_check check (type in (
  'comment', 'suggestion', 'suggestion_result', 'reading_comment'
));
