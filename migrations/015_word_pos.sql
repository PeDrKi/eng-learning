-- ============================================================
-- 015 — từ loại (part of speech) của mỗi từ.
--
-- Một từ có thể thuộc nhiều từ loại (fast: tính từ + trạng từ) nên lưu dạng mảng mã. Mảng rỗng =
-- chưa chọn. Danh sách mã PHẢI khớp với POS_CODES ở words.schemas.js và lib/partsOfSpeech.js (FE);
-- tên hiển thị (danh từ, noun...) nằm ở file dịch của FE, DB chỉ giữ mã.
-- ============================================================
alter table words
  add column pos text[] not null default '{}',
  add constraint words_pos_known check (
    pos <@ array['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction',
                 'determiner', 'article', 'interjection', 'numeral', 'auxiliary', 'modal',
                 'phrasal_verb', 'idiom', 'abbreviation', 'prefix', 'suffix']::text[]
  );
