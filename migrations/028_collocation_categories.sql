-- ============================================================
-- 028 — Collocation chia thành 6 loại (+ giữ "Mẫu động từ"):
--   phrasal_verb                 — Verb + Particle            (give up, go away)
--   prepositional_verb           — Verb + Preposition         (depend on, look at)
--   phrasal_prepositional_verb   — Verb + Particle + Prep     (put up with, look forward to)
--   adjective_prep               — Adjective + Preposition    (good at, interested in)
--   noun_prep                    — Noun + Preposition         (reason for, solution to)
--   verb_noun                    — Verb + Noun                (make a decision, take a break)
--   verb_pattern                 — giữ nguyên (prevent sb from V-ing…)
--
-- Loại cũ `dependent_prep` (gộp động từ / tính từ / danh từ + giới từ) được chia lại, CHỈ đổi nhãn
-- `kind` — nội dung, tiến trình học (phrase_progress) và nhật ký ôn giữ nguyên:
--   1. Khớp từ gốc với bộ có sẵn (src/lib/collocationStarter.js ở FE): tính từ → adjective_prep,
--      danh từ → noun_prep, còn lại → prepositional_verb.
--   2. Không khớp: đoán theo dạng đầy đủ — bắt đầu "be " (be interested in) → adjective_prep; bắt
--      đầu "a "/"an "/"the " (a reason for) → noun_prep; còn lại → prepositional_verb (người dùng
--      đổi lại được trong form).
-- ============================================================
alter table phrases drop constraint if exists phrases_kind_check;

update phrases set kind = case
    when lower(headword) in ('interested', 'good', 'afraid', 'proud', 'responsible', 'aware', 'capable',
                             'famous', 'similar', 'different', 'keen', 'fond', 'tired', 'familiar',
                             'married', 'addicted', 'jealous', 'satisfied', 'full', 'excited')
      then 'adjective_prep'
    when lower(headword) in ('reason', 'solution', 'increase', 'effect', 'need', 'damage')
      then 'noun_prep'
    when lower(phrase) like 'be %' then 'adjective_prep'
    when lower(phrase) like 'a %' or lower(phrase) like 'an %' or lower(phrase) like 'the %' then 'noun_prep'
    else 'prepositional_verb'
  end
where kind = 'dependent_prep';

alter table phrases add constraint phrases_kind_check check (kind in (
  'phrase', 'phrasal_verb', 'prepositional_verb', 'phrasal_prepositional_verb',
  'adjective_prep', 'noun_prep', 'verb_noun', 'verb_pattern'
));
