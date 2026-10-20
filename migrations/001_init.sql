-- ============================================================
-- 001_init — schema ban đầu của tuvung-api.
--
-- Chuyển từ supabase-schema.sql của bản FE, với các thay đổi:
--   • `auth.users` (của Supabase) → bảng `users` của chính mình. Bảng `profiles` cũ được
--     GỘP vào `users` (email + is_super_admin), vì không còn lý do tách riêng: trước đây
--     tách ra chỉ vì client không đọc được auth.users.
--   • Bỏ toàn bộ Row Level Security (RLS) và `auth.uid()`: phân quyền giờ nằm ở tầng BE
--     (middleware + service), KHÔNG còn ở DB. Mọi truy vấn trong BE PHẢI tự lọc theo user.
--   • Bỏ các hàm RPC create_group/join_group/regenerate_invite_code/is_super_admin/
--     deck_group_id — sẽ viết lại thành code trong service tương ứng.
--   • GIỮ trigger `handle_new_word` (tạo sẵn dòng word_progress khi thêm từ): đây là
--     PL/pgSQL thuần của Postgres, không phụ thuộc Supabase, và giữ ở DB đảm bảo không
--     đường ghi nào quên tạo tiến trình.
--   • Thêm bảng refresh_tokens và password_reset_tokens cho hệ thống xác thực tự làm.
--
-- Tên bảng/cột dữ liệu học tập giữ NGUYÊN như bản Supabase để FE ít phải sửa và để
-- chuyển dữ liệu cũ sang được bằng pg_dump/pg_restore (xem README).
-- ============================================================

-- --------------------------------------------------------------
-- Người dùng & xác thực
-- --------------------------------------------------------------
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  -- Băm bằng bcrypt — cùng thuật toán Supabase Auth dùng (auth.users.encrypted_password),
  -- nên khi chuyển dữ liệu sang, người dùng cũ vẫn đăng nhập được bằng mật khẩu cũ.
  password_hash text not null,
  is_super_admin boolean not null default false, -- chỉ bật được bằng SQL thủ công
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- Email không phân biệt hoa/thường: BE luôn lưu dạng chữ thường, index này chặn trùng tuyệt đối.
create unique index users_email_lower_idx on users (lower(email));

-- Refresh token: chỉ lưu HASH (sha256), không lưu token gốc — lộ DB cũng không dùng được.
-- `family_id`: mọi token sinh ra nối tiếp nhau từ 1 lần đăng nhập chung 1 family. Nếu 1 token
-- đã bị thay thế lại được dùng lại (dấu hiệu bị đánh cắp) → thu hồi cả family.
create table refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  family_id uuid not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid references refresh_tokens(id) on delete set null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index refresh_tokens_user_idx on refresh_tokens (user_id);
create index refresh_tokens_family_idx on refresh_tokens (family_id);

create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index password_reset_tokens_user_idx on password_reset_tokens (user_id);

-- --------------------------------------------------------------
-- Nhóm học tập (tạo trước decks vì decks.group_id tham chiếu tới groups)
-- --------------------------------------------------------------
create table groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz default now()
);

create table group_members (
  group_id uuid references groups(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz default now(),
  primary key (group_id, user_id)
);
create index group_members_user_idx on group_members (user_id);

-- --------------------------------------------------------------
-- Chủ đề, từ vựng, tiến trình học
-- --------------------------------------------------------------
create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  group_id uuid references groups(id) on delete cascade, -- null = chủ đề cá nhân
  name text not null,
  color text default '#C9A15E',
  created_at timestamptz default now()
);
create index decks_user_created_idx on decks (user_id, created_at);
create index decks_group_idx on decks (group_id);

create table words (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  deck_id uuid references decks(id) on delete set null,
  word text not null,
  meaning text not null,
  example text default '',
  ipa text default '',
  audio_url text default '',
  tags text[] not null default '{}',
  created_at timestamptz default now()
);
create index words_deck_idx on words (deck_id);
create index words_tags_idx on words using gin (tags);
create index words_user_created_idx on words (user_id, created_at desc);

create table word_progress (
  id uuid primary key default gen_random_uuid(),
  word_id uuid references words(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  -- Chiều Anh→Việt (nhận diện)
  ease_factor real default 2.5,
  interval_days real default 0,
  repetitions int default 0,
  due_at timestamptz default now(),
  last_reviewed_at timestamptz,
  -- Chiều Việt→Anh (nhớ ra từ)
  ease_factor_rev real default 2.5,
  interval_days_rev real default 0,
  repetitions_rev int default 0,
  due_at_rev timestamptz default now(),
  last_reviewed_at_rev timestamptz,
  quiz_correct int default 0,
  quiz_wrong int default 0,
  unique (word_id, user_id)
);
create index word_progress_user_due_idx on word_progress (user_id, due_at);
create index word_progress_user_due_rev_idx on word_progress (user_id, due_at_rev);
create index word_progress_word_idx on word_progress (word_id);

create function handle_new_word()
returns trigger
language plpgsql
as $$
begin
  insert into word_progress (word_id, user_id) values (new.id, new.user_id)
  on conflict (word_id, user_id) do nothing;
  return new;
end;
$$;

create trigger on_word_created
  after insert on words
  for each row execute function handle_new_word();

create table review_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  word_id uuid references words(id) on delete cascade,
  quality int not null,
  direction text not null default 'recognition', -- 'recognition' (Anh→Việt) | 'production' (Việt→Anh)
  reviewed_at timestamptz default now()
);
create index review_log_user_time_idx on review_log (user_id, reviewed_at);
create index review_log_word_idx on review_log (word_id);

create table user_settings (
  user_id uuid primary key references users(id) on delete cascade,
  new_cards_per_day int not null default 20,
  updated_at timestamptz default now()
);

-- --------------------------------------------------------------
-- Câu giao tiếp
-- --------------------------------------------------------------
create table phrases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  deck_id uuid references decks(id) on delete set null,
  phrase text not null,
  meaning text not null,
  usage_context text default '',
  example text default '',
  formality text not null default 'neutral',
  created_at timestamptz default now(),
  constraint phrases_formality_check check (formality in ('formal', 'informal', 'neutral'))
);
create index phrases_user_created_idx on phrases (user_id, created_at desc);
create index phrases_deck_idx on phrases (deck_id);
