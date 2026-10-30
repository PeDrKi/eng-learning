-- ============================================================
-- 022 — COLLOCATIONS: giới từ cố định (rely + on) và mẫu động từ (prevent sb from V-ing).
--
-- Dùng lại bảng `phrases` thay vì tạo bảng mới: collocation là một loại cụm cố định, nên được
-- hưởng nguyên phần ôn tập đã có (phrase_progress + FSRS, review_log.phrase_id, hàng đợi offline).
-- Cột `kind` phân biệt; mặc định 'phrase' → mọi câu giao tiếp đang có giữ nguyên như cũ.
--
--   phrase        — dạng đầy đủ để hiển thị: "rely on sb/sth", "prevent sb from V-ing"
--   headword      — từ gốc: "rely", "prevent", "interested"
--   answer        — phần cần nhớ, cũng là đáp án khi luyện: "on", "from V-ing"
--   pattern_group — nhóm mẫu (tuỳ chọn): "V + sb + from + V-ing"
--   mistakes      — các dạng SAI hay gặp ("in", "to V"): hiện cho người học, và làm đáp án nhiễu
--
-- Khác câu giao tiếp (sổ tay cá nhân), collocation trong chủ đề của NHÓM được chia sẻ như từ
-- vựng — luật quyền ở modules/access/permissions.js. Vì vậy người khác chủ sở hữu cũng cần dòng
-- phrase_progress của riêng mình: service tạo khi họ ôn lần đầu (trigger chỉ tạo cho người thêm).
-- ============================================================
alter table phrases
  add column if not exists kind text not null default 'phrase',
  add column if not exists headword text not null default '',
  add column if not exists answer text not null default '',
  add column if not exists pattern_group text not null default '',
  add column if not exists mistakes text[] not null default '{}';

alter table phrases
  add constraint phrases_kind_check check (kind in ('phrase', 'dependent_prep', 'verb_pattern')),
  -- Collocation thiếu từ gốc hoặc đáp án thì không tạo được bài luyện → chặn ngay ở DB.
  add constraint phrases_collocation_fields check (kind = 'phrase' or (headword <> '' and answer <> ''));

create index if not exists phrases_user_kind_idx on phrases (user_id, kind);
