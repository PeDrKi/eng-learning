-- ============================================================
-- 023 — CỘNG ĐỒNG (giai đoạn 1): công khai chủ đề cá nhân, "Lưu vào thư viện".
--
-- Chỉ chủ đề CÁ NHÂN được công khai (chủ đề nhóm thuộc nhóm, không thuộc một người). Công khai
-- = hiện ở trang Khám phá cho mọi người đã đăng nhập; chủ sở hữu vẫn là người duy nhất sửa được.
--
-- deck_follows: ai đã "Lưu vào thư viện" chủ đề nào. Người lưu HỌC THẲNG từ của chủ đề đó với
-- lịch ôn riêng (word_progress theo user_id, như từ trong chủ đề nhóm) và thấy ngay các chỉnh
-- sửa của chủ sở hữu. Tắt công khai KHÔNG tự xoá các dòng này: người đã lưu vẫn học tiếp, chỉ
-- không ai lưu thêm được — muốn thu hồi hẳn thì chủ sở hữu chọn "thu hồi" (xoá các dòng này).
-- ============================================================
alter table decks
  add column if not exists is_public boolean not null default false,
  add column if not exists description text not null default '',
  add column if not exists published_at timestamptz;

alter table decks
  add constraint decks_public_personal_only check (not is_public or group_id is null),
  add constraint decks_description_length check (char_length(description) <= 500);

create index if not exists decks_public_idx on decks (published_at desc) where is_public;

create table if not exists deck_follows (
  user_id uuid not null references users(id) on delete cascade,
  deck_id uuid not null references decks(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, deck_id)
);
create index if not exists deck_follows_deck_idx on deck_follows (deck_id);
