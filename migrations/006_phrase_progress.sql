-- ============================================================
-- 006 — cho CÂU GIAO TIẾP học được như từ vựng.
--
-- Trước đây `phrases` chỉ là một danh sách để lưu: không ôn, không nhắc, không vào thống kê —
-- người dùng lưu câu vào rồi không có lý do gì quay lại. Migration này thêm tiến trình học cho
-- câu, dùng đúng thuật toán SRS của từ vựng.
--
-- Khác với từ vựng: câu chỉ học MỘT chiều (nhìn nghĩa tiếng Việt, tự nhớ lại câu tiếng Anh) —
-- đó là cách người ta thật sự dùng một cuốn sổ mẫu câu. Nên không có các cột hậu tố "_rev".
-- ============================================================
create table if not exists phrase_progress (
  id uuid primary key default gen_random_uuid(),
  phrase_id uuid references phrases(id) on delete cascade not null,
  user_id uuid references users(id) on delete cascade not null,
  ease_factor real default 2.5,
  interval_days real default 0,
  repetitions int default 0,
  due_at timestamptz default now(),
  last_reviewed_at timestamptz,
  unique (phrase_id, user_id)
);
create index if not exists phrase_progress_user_due_idx on phrase_progress (user_id, due_at);

-- Tạo sẵn dòng tiến trình ngay khi thêm câu — giữ ở DB như handle_new_word() để không đường ghi
-- nào quên (API thêm 1 câu, thêm hàng loạt, hay nhập từ file sau này).
create or replace function handle_new_phrase()
returns trigger
language plpgsql
as $$
begin
  insert into phrase_progress (phrase_id, user_id) values (new.id, new.user_id)
  on conflict (phrase_id, user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists phrases_after_insert on phrases;
create trigger phrases_after_insert after insert on phrases
for each row execute function handle_new_phrase();

-- Câu đã có từ trước migration cũng phải học được.
insert into phrase_progress (phrase_id, user_id)
select p.id, p.user_id from phrases p
on conflict (phrase_id, user_id) do nothing;

-- Nhật ký ôn: cho phép ghi lượt ôn CÂU, không chỉ từ.
--
-- Ràng buộc là "không quá một" chứ không phải "đúng một": word_id vốn đã cho phép NULL từ 001
-- (xoá từ thì dòng nhật ký vẫn còn để không mất chuỗi ngày học), nên ép "đúng một" sẽ làm hỏng
-- dữ liệu cũ. Điều cần chặn chỉ là một dòng vừa gắn từ vừa gắn câu.
alter table review_log add column if not exists phrase_id uuid references phrases(id) on delete cascade;
alter table review_log drop constraint if exists review_log_target_check;
alter table review_log add constraint review_log_target_check check (num_nonnulls(word_id, phrase_id) <= 1);
