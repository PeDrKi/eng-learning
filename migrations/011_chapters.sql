-- Chương: gom nhiều chủ đề (bài) thành một cụm, VD "Chương 1" gồm "Bài 1" … "Bài 10".
-- Cùng phạm vi với chủ đề: cá nhân (group_id null) hoặc của một nhóm học. Một chủ đề thuộc tối
-- đa một chương; xoá chương thì các chủ đề bên trong giữ nguyên, chỉ không còn thuộc chương nào.
create table chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  group_id uuid references groups(id) on delete cascade,
  name text not null,
  created_at timestamptz default now()
);
create index chapters_user_idx on chapters (user_id);
create index chapters_group_idx on chapters (group_id);

alter table decks add column chapter_id uuid references chapters(id) on delete set null;
create index decks_chapter_idx on decks (chapter_id);
