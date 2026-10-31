-- ============================================================
-- 027 — Chủ đề NHÓM cũng được chia sẻ ra cộng đồng (trưởng nhóm bật/tắt).
--
-- Bỏ ràng buộc decks_public_personal_only (migration 023). Không đổi dữ liệu nào: mọi chủ đề nhóm
-- đang có vẫn is_public = false cho tới khi trưởng nhóm tự bật.
-- ============================================================
alter table decks drop constraint if exists decks_public_personal_only;
