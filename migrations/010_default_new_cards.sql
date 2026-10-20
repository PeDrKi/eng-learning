-- Mặc định số từ mới mỗi ngày: 20 → 5 (người dùng quyết định 12/10/2026).
--
-- Mô phỏng lịch ôn (tuvung-react/src/lib/dailyPlan.test.js): mỗi từ mới/ngày kéo theo ~14 lượt ôn
-- mỗi ngày khi đã vào nhịp. 20 từ/ngày ≈ 280 lượt ≈ 47 phút — quá nặng cho người bận, dồn thẻ rồi
-- bỏ cuộc. 5 từ/ngày ≈ 70 lượt ≈ 12 phút.
--
-- Chỉ đổi giá trị mặc định cho dòng MỚI. Dòng đã có giữ nguyên: không phân biệt được 20 là do người
-- dùng tự chọn hay chỉ là mặc định cũ, nên không tự ý đổi cài đặt của ai.
alter table user_settings alter column new_cards_per_day set default 5;
