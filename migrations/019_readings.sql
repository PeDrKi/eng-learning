-- ============================================================
-- 019 — BÀI ĐỌC kèm ghi chú (trang "Đọc & ghi chú").
--
-- Người học dán một đoạn văn / bài văn / hội thoại, rồi bôi đen để ghi lại từ mới, mẫu ngữ pháp
-- và câu thông dụng gặp trong đó. Ghi chú nằm chung một dòng với bài đọc (jsonb) thay vì bảng
-- riêng: chúng luôn được đọc/ghi cùng bài, số lượng nhỏ (tối đa 300/bài, BE kiểm tra), và lưu
-- tự động cả cụm sau mỗi lần sửa — một lệnh UPDATE gọn hơn đồng bộ từng dòng.
--
-- Sổ tay CÁ NHÂN như câu giao tiếp: chỉ chủ sở hữu xem/sửa/xoá.
-- ============================================================
create table if not exists readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete cascade not null,
  title text not null default '',
  content text not null default '',
  notes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists readings_user_updated_idx on readings (user_id, updated_at desc);
