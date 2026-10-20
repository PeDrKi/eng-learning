# tuvung-api — Backend cho app Từ Vựng

Backend Express + PostgreSQL thay thế Supabase cho bản FE `tuvung-react`.

**Trạng thái:** đã có đủ mọi API thay thế Supabase (xác thực, chủ đề, từ vựng, tiến trình học, nhật ký ôn tập, cài đặt, câu giao tiếp, nhóm học tập) và FE `tuvung-react` đã gọi hoàn toàn qua BE này. Ngoài ra có quản lý tài khoản (thiết bị đang đăng nhập, xoá tài khoản), chuyển quyền trưởng nhóm, và phân trang cho danh sách dài.

## Chạy ở máy local

Yêu cầu: Node.js 20 trở lên, và Docker (hoặc một Postgres 14+ cài sẵn).

```bash
npm install
docker compose up -d          # Postgres local, tạo sẵn DB tuvung_dev + tuvung_test
cp .env.example .env          # rồi điền JWT_ACCESS_SECRET (lệnh tạo có sẵn trong file)
npm run migrate               # dựng schema
npm run seed                  # đổ dữ liệu mẫu (tuỳ chọn, xem bên dưới)
npm run dev                   # http://localhost:3000, tự khởi động lại khi sửa code
```

Các lệnh khác:

- `npm test`: chạy toàn bộ test trên DB `tuvung_test`. DB này bị xoá sạch và dựng lại mỗi lần chạy. Đổi DB test bằng biến `TEST_DATABASE_URL`.
- `npm run cleanup`: dọn dữ liệu hết hạn (server cũng tự chạy việc này mỗi 24 giờ).
- `npm run lint` / `npm run format`: kiểm tra và định dạng code (cùng cấu hình Prettier với FE).

Khi `MAIL_DRIVER=console`, email đặt lại mật khẩu được in ra terminal thay vì gửi thật.

## Dữ liệu mẫu — `npm run seed`

Dựng xong schema thì database rỗng, mà app rỗng thì không xem được gì: màn Học không có thẻ, Thống
kê không có biểu đồ, không có tài khoản admin để mở Dashboard. `npm run seed` đổ vào một bộ dữ liệu
đủ dùng ngay. Mật khẩu chung cho mọi tài khoản mẫu: **`MatKhau123!`**

| Email                      | Vai trò     | Dùng để xem                                                                      |
| -------------------------- | ----------- | -------------------------------------------------------------------------------- |
| `hoc@tuvung.test`          | user        | Người học chính: 60 từ, thẻ đến hạn, chuỗi ngày học, từ "khó nhớ", câu giao tiếp |
| `super@tuvung.test`        | super_admin | Dashboard quản trị, quản lý tài khoản                                            |
| `admin@tuvung.test`        | admin       | Quản lý nhóm và nội dung nhóm (không quản lý tài khoản)                          |
| `moi@tuvung.test`          | user        | Người dùng mới tinh — màn chào và bộ từ mẫu                                      |
| `khoa@tuvung.test`         | user        | Tài khoản bị khoá — đăng nhập phải bị từ chối (403)                              |
| `nang@tuvung.test`         | user        | Người học nặng (mặc định 2000 từ) — thử hiệu năng, phân trang                    |
| `ban1`, `ban2@tuvung.test` | user        | Thành viên của 2 nhóm mẫu (mã mời `IELTS-TOI`, `CONG-SO-1`)                      |

```bash
npm run seed                 # mặc định
N_WORDS=300 npm run seed     # tài khoản "người học nặng" chỉ 300 từ, chạy nhanh hơn
```

Hai điều script tự giữ, vì nó GHI vào database:

- **Chỉ chạy trên database ở máy mình.** `DATABASE_URL` trỏ ra ngoài localhost là nó dừng, trừ khi
  đặt `SEED_ALLOW_REMOTE=toi-chac-chan`. Dữ liệu mẫu lẫn vào dữ liệu người dùng thật thì không có
  cách nào gỡ ra cho gọn.
- **Chỉ đụng tới các tài khoản `@tuvung.test`.** Mỗi lần chạy nó xoá rồi tạo lại đúng những tài
  khoản đó, nên chạy lại bao nhiêu lần cũng ra cùng kết quả và không nhân đôi dữ liệu. Tài khoản
  thật trong cùng database không bị sửa một dòng nào (có test giữ điều này: `test/seed.test.js`).

Sửa hoặc thêm từ vựng, câu giao tiếp, chủ đề, nhóm: `src/db/seedData.js`. Phần logic ghi database
nằm riêng ở `src/db/seed.js`.

## Cấu trúc

```
migrations/          — các file SQL đánh số (001 schema ban đầu, 002 index phân trang tiến trình, 003 cài đặt phiên học, 004 vai trò + khoá tài khoản, …, 011 chủ đề cấp trên — bảng chapters), chạy tuần tự bằng `npm run migrate`
src/
  server.js          — điểm khởi động: đọc config, mở pool DB, lắng nghe cổng, tắt êm khi nhận SIGTERM
  app.js             — dựng app Express từ các phụ thuộc truyền vào (dễ test)
  config.js          — đọc và kiểm tra biến môi trường (zod)
  db/                — pool kết nối, helper transaction, bộ chạy migration
  lib/               — hàm dùng chung: lỗi HTTP, JWT/token, băm mật khẩu, gửi email, phân trang,
                       vai trò, hạn mức dữ liệu
  middleware/        — requireAuth, requireActiveUser (vai trò + khoá tài khoản), validateBody, checkOrigin, rate limit, xử lý lỗi
  modules/access/    — LUẬT PHÂN QUYỀN (permissions.js) + nạp vai trò người dùng mỗi request
  modules/<tên>/     — mỗi nhóm tính năng: *.schemas.js (kiểm tra input), *.service.js
                       (nghiệp vụ + truy vấn DB), *.routes.js (HTTP)
  modules/users/     — thao tác trên tài khoản dùng chung cho auth và admin (xoá tài khoản)
test/                — test tích hợp chạy trên Postgres thật
```

## Khác biệt so với schema Supabase

`migrations/001_init.sql` giữ **nguyên tên bảng và cột** dữ liệu học tập, để FE ít phải sửa và để chuyển dữ liệu cũ được. Các thay đổi:

- **`auth.users` → `users`:** bảng `profiles` được gộp vào `users` (email, và vai trò `role` thay cho cờ super admin cũ).
- **Bỏ RLS và các hàm RPC:** phân quyền giờ nằm ở tầng BE. Mọi truy vấn trong service phải tự lọc theo người dùng. Đây là điểm cần cẩn thận nhất khi viết các module tiếp theo.
- **Giữ trigger `handle_new_word`:** đây là PL/pgSQL thuần, không phụ thuộc Supabase.
- **Thêm `refresh_tokens` và `password_reset_tokens`.**

## API xác thực

> **Tài liệu API đầy đủ (57 endpoint, ràng buộc từng field, dữ liệu mẫu, bảng mã lỗi): [`docs/API.md`](docs/API.md).** Test `test/apiDocs.test.js` giữ tài liệu đó khớp với code. Các mục dưới đây là tóm tắt và giải thích thiết kế.

Mọi lỗi có chung định dạng:

```json
{ "error": { "code": "invalid_credentials", "message": "Sai email hoặc mật khẩu.", "details": [] } }
```

`code` là giá trị cố định để FE xử lý theo logic. `message` là tiếng Việt, hiển thị thẳng được. `details` chỉ có khi lỗi `validation_error`, liệt kê lỗi của từng field.

| Endpoint                                                     | Mô tả                                     | Thành công      | Lỗi thường gặp                            |
| ------------------------------------------------------------ | ----------------------------------------- | --------------- | ----------------------------------------- |
| `POST /auth/register` `{email, password}`                    | Đăng ký, đăng nhập luôn                   | 201 + phiên     | 409 `email_taken`, 400 `validation_error` |
| `POST /auth/login` `{email, password}`                       | Đăng nhập                                 | 200 + phiên     | 401 `invalid_credentials`                 |
| `POST /auth/refresh` (cookie)                                | Đổi refresh token lấy phiên mới           | 200 + phiên     | 401 `invalid_refresh_token`               |
| `POST /auth/logout` (cookie)                                 | Thu hồi phiên hiện tại                    | 204             | —                                         |
| `GET /auth/me` (Bearer)                                      | Thông tin tài khoản                       | 200 `{user}`    | 401 `token_expired` / `invalid_token`     |
| `POST /auth/forgot-password` `{email}`                       | Gửi email đặt lại mật khẩu                | 202 (luôn luôn) | 429 `rate_limited`                        |
| `POST /auth/reset-password` `{token, password}`              | Đặt mật khẩu mới bằng token trong email   | 200 + phiên     | 400 `invalid_reset_token`                 |
| `PUT /auth/password` (Bearer) `{current_password, password}` | Đổi mật khẩu khi đang đăng nhập           | 200 + phiên     | 400 `invalid_current_password`            |
| `GET /auth/sessions` (Bearer + cookie)                       | Các thiết bị đang đăng nhập               | 200 `[session]` | —                                         |
| `DELETE /auth/sessions/:id` (Bearer)                         | Đăng xuất 1 thiết bị                      | 204             | 404 `not_found`                           |
| `DELETE /auth/sessions` (Bearer + cookie)                    | Đăng xuất mọi thiết bị KHÁC               | 200 `{revoked}` | —                                         |
| `DELETE /auth/account` (Bearer) `{password}`                 | Xoá vĩnh viễn tài khoản                   | 204             | 400 `invalid_current_password`            |
| `GET /health`                                                | App còn sống (Render dùng; không chạm DB) | 200             | —                                         |
| `GET /health/db`                                             | Kiểm tra kết nối DB                       | 200             | 503                                       |

"Phiên" là body có dạng `{ access_token, token_type: "bearer", expires_in, user }`, kèm cookie `tv_refresh`. Hình dạng này cố ý giống session của Supabase.

Mật khẩu **mới** (đăng ký, đặt lại, đổi) cần tối thiểu 8 ký tự và tối đa 72 byte. Đăng nhập không kiểm tra độ dài, nên tài khoản cũ có mật khẩu ngắn hơn vẫn đăng nhập được.

**Thiết bị đang đăng nhập.** Mỗi `session` có dạng `{ id, user_agent, created_at, last_active_at, current }`; `current` là thiết bị đang gọi (nhận ra qua cookie refresh). Một thiết bị bị đăng xuất không gia hạn phiên được nữa, nhưng access token nó đang giữ còn dùng được tới khi hết hạn (tối đa 15 phút).

**Xoá tài khoản.** Dữ liệu cá nhân (chủ đề, từ, tiến trình, nhật ký ôn, câu giao tiếp, cài đặt, phiên đăng nhập) bị xoá theo. Nội dung dùng chung của nhóm được giữ lại cho nhóm: chủ đề nhóm và từ trong chủ đề nhóm do người này tạo được chuyển cho một trưởng nhóm khác. Nếu người này là trưởng nhóm duy nhất, thành viên vào nhóm sớm nhất lên làm trưởng nhóm. Nhóm chỉ có mỗi người này thì bị xoá.

## API chủ đề & từ vựng

Mọi endpoint dưới đây bắt buộc header `Authorization: Bearer <access_token>`. Dữ liệu trả về là các dòng của bảng, với tên cột giữ nguyên như bản Supabase. Các field thừa mà client gửi kèm (ví dụ `user_id`) bị bỏ qua: chủ sở hữu luôn là người đang đăng nhập.

| Endpoint                                                                     | Mô tả                                                    | Thành công   |
| ---------------------------------------------------------------------------- | -------------------------------------------------------- | ------------ |
| `GET /decks`                                                                 | Chủ đề xem được, cũ trước mới sau                        | 200 `[deck]` |
| `POST /decks` `{name, color?, group_id?}`                                    | Tạo chủ đề (cá nhân, hoặc của nhóm nếu là trưởng nhóm)   | 201 `deck`   |
| `POST /decks/bulk` `{decks: [{name, color?}]}`                               | Tạo tối đa 200 chủ đề cá nhân (nhập file)                | 201 `[deck]` |
| `PATCH /decks/:id` `{name?, color?}`                                         | Đổi tên/màu                                              | 200 `deck`   |
| `DELETE /decks/:id`                                                          | Xoá chủ đề (từ bên trong chuyển về "chưa phân loại")     | 204          |
| `GET/POST /chapters`, `PATCH/DELETE /chapters/:id`                           | Chương: gom nhiều chủ đề thành một cụm (xem docs/API.md) | 200/201/204  |
| `GET /words`                                                                 | Từ xem được, mới trước cũ sau (phân trang: xem bên dưới) | 200 `[word]` |
| `POST /words` `{word, meaning, example?, ipa?, audio_url?, tags?, deck_id?}` | Thêm từ (tự tạo dòng `word_progress`)                    | 201 `word`   |
| `POST /words/bulk` `{words: [...]}`                                          | Thêm tối đa 1000 từ; một từ sai là từ chối cả lô         | 201 `[word]` |
| `PATCH /words/:id`                                                           | Sửa các field gửi lên, kể cả `deck_id` để chuyển chủ đề  | 200 `word`   |
| `DELETE /words/:id`                                                          | Xoá từ và tiến trình học của nó                          | 204          |

**Phân trang** (`GET /words` và `GET /progress`). Không truyền `limit` thì nhận mảng đầy đủ như trước. Truyền `?limit=N` (1–1000) thì nhận `{ items: [...], next_cursor }`; gọi tiếp với `&cursor=<next_cursor>` cho tới khi `next_cursor` là `null`. Con trỏ là chuỗi mờ, gửi lại nguyên văn; con trỏ sai trả 400 `invalid_cursor`. FE tải mỗi trang 500 dòng.

Lỗi phân quyền:

- **404 `not_found`:** không tồn tại, hoặc không có quyền xem. Hai trường hợp cố ý trả giống nhau để không lộ dữ liệu của người khác.
- **403 `forbidden`:** xem được nhưng không có quyền sửa/xoá, ví dụ thành viên sửa từ trong chủ đề nhóm.
- **400 `deck_not_found`:** `deck_id` gửi lên không tồn tại hoặc không xem được.

## API tiến trình học, nhật ký ôn tập, cài đặt

Tất cả chỉ đọc/ghi dữ liệu của **chính người đang đăng nhập**.

| Endpoint                                                                   | Mô tả                                                             | Thành công       |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------- |
| `GET /progress`                                                            | Mọi dòng `word_progress` của mình (phân trang như `GET /words`)   | 200 `[progress]` |
| `PATCH /progress/:wordId`                                                  | Ghi các field SRS/quiz gửi lên; chưa có dòng thì tạo mới          | 200 `progress`   |
| `GET /review-log?since=ISO`                                                | Nhật ký ôn của mình từ `since` (mặc định 90 ngày), mới nhất trước | 200 `[entry]`    |
| `POST /review-log` `{word_id, quality, direction?, source?, reviewed_at?}` | Ghi 1 lần chấm thẻ (`quality` 0–3; `source`: study/quiz/spelling) | 201 `entry`      |
| `GET /settings`                                                            | Cài đặt học (chưa lưu thì trả mặc định)                           | 200 `settings`   |
| `PUT /settings` `{...}`                                                    | Lưu các field gửi lên, field khác giữ nguyên                      | 200 `settings`   |

`settings` có dạng `{ new_cards_per_day, session_size, daily_goal, reviews_per_day }`: số từ mới mỗi ngày (0–200, mặc định 5), số thẻ mỗi phiên học (3–50, mặc định 10), mục tiêu lượt ôn mỗi ngày (1–500, mặc định 20), và số thẻ ôn lại tối đa mỗi ngày (10–1000, mặc định 100). BE chỉ lưu các con số này; việc chia phiên và áp giới hạn do FE làm (`lib/studyQueue.js`).

Thời điểm ôn mặc định lấy theo giờ server. FE chỉ gửi `reviewed_at` khi đồng bộ kết quả ôn lúc mất mạng: giá trị được giữ nếu nằm trong 7 ngày gần nhất và không ở tương lai, ngoài khoảng đó thì dùng giờ server.

Các field của `PATCH /progress/:wordId`: `ease_factor`, `interval_days`, `repetitions`, `due_at`, `last_reviewed_at`, cùng bộ tương ứng có đuôi `_rev` cho chiều Việt→Anh, và `quiz_correct`, `quiz_wrong`. Thời gian theo định dạng ISO 8601. Chỉ ghi tiến trình được cho từ mình **xem được** (404 nếu không).

## API câu giao tiếp

Sổ tay **cá nhân**: chỉ chủ sở hữu xem, sửa, xoá, kể cả trưởng nhóm hay super admin cũng không thấy. `deck_id` phải là chủ đề mình xem được (chủ đề riêng, hoặc chủ đề của nhóm mình tham gia).

| Endpoint                                                                            | Mô tả                                                                       | Thành công     |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | -------------- |
| `GET /phrases`                                                                      | Câu giao tiếp của mình, mới nhất trước                                      | 200 `[phrase]` |
| `POST /phrases` `{phrase, meaning, usage_context?, example?, formality?, deck_id?}` | Thêm câu (`formality`: `formal`, `informal`, `neutral`; mặc định `neutral`) | 201 `phrase`   |
| `PATCH /phrases/:id`                                                                | Sửa các field gửi lên                                                       | 200 `phrase`   |
| `DELETE /phrases/:id`                                                               | Xoá                                                                         | 204            |

Xoá chủ đề thì câu giao tiếp bên trong chuyển về "chưa phân loại" (`deck_id = null`), không bị xoá theo.

## API nhóm học tập

Thay cho 3 hàm RPC (`create_group`, `join_group`, `regenerate_invite_code`) và các truy vấn trực tiếp vào `groups`, `group_members`, `profiles` của bản Supabase.

| Endpoint                                     | Ai được gọi                                                        | Thành công          |
| -------------------------------------------- | ------------------------------------------------------------------ | ------------------- |
| `GET /groups`                                | mọi người (chỉ thấy nhóm mình tham gia; super admin thấy mọi nhóm) | 200 `[group]`       |
| `POST /groups` `{name}`                      | mọi người; người tạo thành trưởng nhóm                             | 201 `group`         |
| `POST /groups/join` `{code}`                 | mọi người (tối đa 20 lần thử / 15 phút / IP)                       | 200 `group`         |
| `PATCH /groups/:id` `{name}`                 | trưởng nhóm, super admin                                           | 200 `group`         |
| `POST /groups/:id/invite-code`               | trưởng nhóm, super admin; mã cũ mất hiệu lực ngay                  | 200 `{invite_code}` |
| `PATCH /groups/:id/members/:userId` `{role}` | trưởng nhóm, super admin; `role` là `admin` hoặc `member`          | 200 `group`         |
| `DELETE /groups/:id/members/:userId`         | chính mình (rời nhóm); trưởng nhóm, super admin (mời ra)           | 204                 |
| `GET /groups/:id/stats`                      | trưởng nhóm, super admin                                           | 200 `[stats]`       |
| `GET /groups/:id/progress`                   | trưởng nhóm, super admin (bản cũ, giữ cho FE cũ)                   | 200 `[progress]`    |

Mỗi `group` trả về có dạng `{ id, name, created_by, created_at, invite_code, my_role, members: [{ user_id, role, joined_at, email }] }`, được lọc theo quyền người xem:

- **`invite_code`:** chỉ trưởng nhóm và super admin thấy; thành viên thường nhận `null`.
- **`members`:** trưởng nhóm và super admin thấy cả nhóm kèm email; thành viên thường chỉ thấy chính mình (giống RLS cũ).
- **`my_role`:** `admin`, `member`, hoặc `null` nếu là super admin không tham gia nhóm.

Vai trò của mình lấy từ `GET /auth/me`: `user.role` (`user`, `admin`, `super_admin`) cùng 2 cờ suy ra `user.is_admin` (admin hoặc super admin) và `user.is_super_admin`.

Trong các bảng ở tài liệu này, chỗ nào ghi "super admin" được quản lý nhóm thì **admin** toàn hệ thống cũng được: hai cấp này có quyền như nhau với nhóm và nội dung nhóm.

`GET /groups/:id/stats` trả **một dòng cho mỗi thành viên hiện tại**, tính gộp trong database và chỉ trên từ nằm trong chủ đề dùng chung của nhóm: `{ user_id, total_words, started, due, quiz_correct, quiz_wrong, last_reviewed_at }`. Kích thước phản hồi chỉ phụ thuộc số thành viên. `GET /groups/:id/progress` là bản cũ (trả từng dòng `word_progress` để client tự tính), giữ lại cho bản FE cũ còn trong cache PWA.

Mã mời mới gồm 8 ký tự ngẫu nhiên, đã bỏ các ký tự dễ nhầm (0/o, 1/l/i), không phân biệt hoa/thường khi nhập. Mã cũ dạng md5 từ bản Supabase vẫn dùng được.

**Nhóm luôn có trưởng nhóm.** Một nhóm có thể có nhiều trưởng nhóm. Trưởng nhóm duy nhất không rời nhóm được, không bị mời ra và không bị hạ vai trò khi nhóm còn thành viên khác (409 `last_admin`): phải đặt người khác làm trưởng nhóm trước. Người cuối cùng trong nhóm thì rời tự do. Đây là thay đổi so với bản Supabase, nơi trưởng nhóm duy nhất rời được và để lại nhóm không ai quản lý.

## Vai trò toàn hệ thống & API quản trị

Cột `users.role` có 3 giá trị (khác với vai trò trưởng nhóm/thành viên trong từng nhóm):

| Vai trò       | Quyền                                         | Cách cấp                                                                         |
| ------------- | --------------------------------------------- | -------------------------------------------------------------------------------- |
| `user`        | Dữ liệu của mình và các nhóm mình tham gia    | Mặc định khi đăng ký                                                             |
| `admin`       | Thêm: thấy và quản lý mọi nhóm, nội dung nhóm | Super admin bổ nhiệm (`PATCH /admin/users/:id`)                                  |
| `super_admin` | Thêm: quản lý tài khoản qua `/admin/*`        | Chỉ bằng SQL: `update users set role = 'super_admin' where lower(email) = '...'` |

Không cấp nào xem được dữ liệu **cá nhân** của người khác. Mọi endpoint `/admin/*` chỉ super admin gọi được (người khác nhận 403).

| Endpoint                                      | Mô tả                                                                                                                                                                                 | Thành công                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `GET /admin/overview?days=`                   | Số liệu gộp toàn hệ thống cho trang tổng quan: tổng số, người học hoạt động, và chuỗi theo ngày (`days` 7–90, mặc định 30). Không chứa dữ liệu của riêng ai; kết quả được nhớ 60 giây | 200 `overview`             |
| `GET /admin/users?q=&limit=&cursor=`          | Danh sách tài khoản, mới đăng ký trước; `q` tìm theo email; phân trang như `GET /words` (mặc định 50)                                                                                 | 200 `{items, next_cursor}` |
| `PATCH /admin/users/:id` `{role?, disabled?}` | Bổ nhiệm/gỡ admin (`role`: `user` hoặc `admin`), khoá/mở khoá (`disabled`)                                                                                                            | 200 `user`                 |
| `DELETE /admin/users/:id`                     | Xoá vĩnh viễn tài khoản; nội dung nhóm được giữ như khi tự xoá                                                                                                                        | 204                        |

Mỗi `user` ở đây có dạng `{ id, email, role, is_admin, is_super_admin, created_at, disabled_at, word_count, last_active_at }`.

Luật an toàn:

- Super admin không tự đổi vai trò, tự khoá hay tự xoá mình ở `/admin`, và không thao tác được trên super admin khác (403). Nhờ vậy hệ thống luôn còn ít nhất một super admin đang hoạt động.
- Super admin duy nhất không tự xoá tài khoản được qua `DELETE /auth/account`.
- **Khoá tài khoản** có hiệu lực ngay: mọi phiên bị thu hồi, mọi endpoint trả 403 `account_disabled`, không đăng nhập, gia hạn phiên hay đặt lại mật khẩu được. Dữ liệu được giữ nguyên. Đăng nhập sai mật khẩu vào tài khoản bị khoá vẫn chỉ nhận `invalid_credentials`, để không lộ tài khoản nào đang bị khoá.
- Vai trò và trạng thái khoá được đọc từ database ở mỗi request (middleware `requireActiveUser`), không lấy từ JWT, nên đổi vai trò cũng có hiệu lực ngay.

## Phân quyền

**Một truy vấn quyền cho mỗi request.** Middleware `requireActiveUser` (chạy sau `requireAuth`) nạp ngữ cảnh quyền của người gọi bằng đúng một truy vấn — vai trò toàn hệ thống, trạng thái khoá, vai trò trong từng nhóm — và gắn vào `req.access`. Route truyền `req.access` làm tham số đầu cho service (`ctx`); service không tự truy vấn lại quyền. Ngoại lệ duy nhất là `presentOne` ở module nhóm, phải nạp lại vì chạy ngay sau khi thành viên hoặc vai trò vừa đổi.

Toàn bộ luật nằm ở `src/modules/access/permissions.js`, viết dạng hàm thuần. Mỗi luật có test riêng trong `test/permissions.test.js`. Truy vấn danh sách lọc bằng SQL tương đương, và có test đối chiếu để SQL và hàm JS luôn cho cùng kết quả. Vai trò trong nhóm được đọc từ DB **mỗi request**, nên bị mời ra khỏi nhóm là mất quyền ngay, không phải chờ token hết hạn.

|                              | Chủ đề cá nhân | Chủ đề nhóm                          |
| ---------------------------- | -------------- | ------------------------------------ |
| Xem chủ đề và từ bên trong   | chủ sở hữu     | thành viên, trưởng nhóm, super admin |
| Thêm từ                      | chủ sở hữu     | thành viên, trưởng nhóm, super admin |
| Tạo, đổi tên, xoá chủ đề     | chủ sở hữu     | trưởng nhóm, super admin             |
| Sửa, xoá từ bất kỳ bên trong | chủ sở hữu     | trưởng nhóm, super admin             |

Người tạo một từ luôn xem được từ đó, kể cả sau khi đã rời nhóm.

**Hai điểm cố ý khác với RLS của bản Supabase:**

- Super admin **không** còn xem hay sửa được chủ đề và từ **cá nhân** của người khác. Với RLS cũ, danh sách từ của super admin lẫn cả dữ liệu cá nhân của mọi người dùng. Quyền super admin giờ chỉ áp dụng cho nội dung nhóm.
- Chuyển từ sang chủ đề cá nhân chỉ được khi chủ đề đó là của chính mình. RLS cũ chỉ kiểm tra "là chủ đề cá nhân", không kiểm tra của ai.
- `GET /progress` chỉ trả dòng của chính mình. Với RLS cũ, trưởng nhóm đọc được `word_progress` của thành viên (để phục vụ dashboard), nên danh sách "tiến trình của tôi" ở FE lẫn cả dòng của người khác. Dashboard sẽ có endpoint riêng ở module Nhóm.
- Ghi tiến trình học hay nhật ký ôn chỉ được cho từ mình xem được. RLS cũ chỉ kiểm tra `user_id`, nên ghi được cho bất kỳ `word_id` nào.
- Thời điểm trong nhật ký ôn lấy theo giờ server, không nhận giờ client gửi.
- Mã mời chỉ trả cho trưởng nhóm và super admin. RLS cũ trả cho mọi thành viên, dù FE chỉ hiển thị cho trưởng nhóm.
- Dashboard nhóm chỉ trả tiến trình của thành viên **hiện tại**. RLS cũ còn trả cả tiến trình của người đã rời nhóm.
- Tham gia nhóm có giới hạn số lần thử, chống dò mã mời.

### Luồng phiên đăng nhập (dành cho FE)

1. **Access token:** JWT sống 15 phút, lưu **trong bộ nhớ** (biến JS, không dùng localStorage). Gửi kèm mọi request bằng header `Authorization: Bearer <token>`.
2. **Refresh token:** nằm trong cookie `httpOnly`, JS không đọc được. Gọi `fetch` tới `/auth/*` phải có `credentials: 'include'`.
3. **Khi mở app:** gọi `POST /auth/refresh`. Nhận 200 nghĩa là vẫn đăng nhập, nhận 401 thì hiện màn đăng nhập. Bước này thay cho `supabase.auth.getSession()`.
4. **Khi API trả 401 `token_expired`:** gọi refresh một lần rồi thử lại request. Nhiều request cùng hết hạn thì chỉ refresh một lần và dùng chung kết quả.
5. **Link đặt lại mật khẩu** có dạng `APP_URL/#reset_token=...`. FE đọc token từ `location.hash` để vào màn đặt mật khẩu mới, thay cho `recoveryMode` của Supabase.

### Các biện pháp bảo mật đã có

- Mật khẩu băm bằng bcrypt. Refresh token và token đặt lại mật khẩu chỉ được lưu ở dạng hash sha256.
- **Xoay vòng refresh token:** mỗi lần refresh sẽ cấp token mới và vô hiệu token cũ. Nếu token cũ bị dùng lại (dấu hiệu bị trộm), toàn bộ phiên đó bị thu hồi. Có cửa sổ ân hạn 10 giây để hai tab cùng refresh một lúc không bị đăng xuất nhầm.
- **Không lộ email nào đã đăng ký:** login trả cùng một lỗi và cùng thời gian phản hồi; forgot-password luôn trả 202 và luôn chờ đủ một thời gian tối thiểu (`PASSWORD_RESET_MIN_RESPONSE_MS`, mặc định 500ms) dù email có tồn tại hay không. Riêng đăng ký vẫn báo 409 `email_taken` khi email đã có tài khoản (giấu hẳn cần xác minh email khi đăng ký, chưa làm), nên đăng ký có giới hạn chặt hơn để việc dò email chậm lại.
- Token đặt lại mật khẩu dùng một lần, hết hạn sau 60 phút, và link mới làm link cũ mất hiệu lực. Đặt lại hoặc đổi mật khẩu sẽ đăng xuất mọi thiết bị khác.
- **Chống lạm dụng:** mỗi tài khoản tối đa 300 request/phút trên các endpoint dữ liệu (429 `rate_limited`), và có hạn mức dữ liệu: 20.000 từ, 500 chủ đề, 5.000 câu giao tiếp, 50 nhóm (409 `quota_exceeded`; chỉnh bằng biến môi trường `QUOTA_WORDS`, `QUOTA_DECKS`, `QUOTA_PHRASES`, `QUOTA_GROUPS`).
- Link phát âm (`audio_url`) chỉ nhận `http://` hoặc `https://`, vì trình duyệt của mọi thành viên nhóm sẽ tải link này.
- Thao tác của super admin trên tài khoản người khác được ghi vào log server (dòng bắt đầu bằng `[admin]`): ai làm, làm gì, với tài khoản nào.
- Kiểm tra Origin trên các endpoint dùng cookie (chống CSRF), CORS chỉ mở cho domain FE, header bảo mật qua `helmet`, và rate limit (429 `rate_limited`):
  - đăng nhập/đăng ký/đổi mật khẩu: 10 lần / 15 phút / IP;
  - đăng nhập **sai**: 10 lần / 15 phút cho mỗi email, dù từ bao nhiêu IP (chặn dò mật khẩu một tài khoản bằng nhiều máy; email chưa đăng ký cũng bị đếm như vậy);
  - đăng ký: thêm 10 lần / giờ / IP;
  - quên mật khẩu: 5 lần / giờ / IP.

## Deploy

Hướng dẫn từng bước (Render + Neon + Resend) nằm ở `DEPLOY.md` tại thư mục gốc của repo, cùng
file `render.yaml`. Một số điểm kỹ thuật:

- **Lệnh khởi động:** `npm run start:render` chạy migration rồi mới khởi động server. Web service
  gói miễn phí của Render không có pre-deploy command; migration có khoá nên chạy lại mỗi lần
  khởi động vẫn an toàn.
- **Kiểm tra sức khoẻ:** `/health` trả ngay, không chạm DB. Render gọi endpoint này liên tục, nếu
  lần nào cũng truy vấn thì Neon không bao giờ được ngủ. Kiểm tra DB thủ công: `/health/db`.
- **Gửi email:** gói miễn phí của Render chặn mọi cổng SMTP, nên dùng `MAIL_DRIVER=resend` +
  `RESEND_API_KEY` (gửi qua HTTPS). `smtp` vẫn dùng được ở nơi khác hoặc gói trả phí.
- **Database Neon:** dùng connection string **trực tiếp** (không có `-pooler`), vì khoá migration
  gắn theo phiên kết nối.
- **Cookie và domain:** cookie refresh chỉ hoạt động ổn định khi FE và BE **cùng site**.
  - Hai địa chỉ `*.onrender.com` khác nhau là khác site. Khi đó phải đặt `COOKIE_SAMESITE=none`,
    và Safari có thể vẫn chặn cookie.
  - Khuyến nghị: tên miền riêng `app.tenmien.com` + `api.tenmien.com`, với `COOKIE_SAMESITE=lax`.
- **Rate limit** đếm trong bộ nhớ, đúng khi chạy 1 instance.

## Dữ liệu từ bản Supabase cũ

Hiện không cần chuyển dữ liệu. Nếu sau này cần: tên bảng/cột dữ liệu giữ nguyên nên dùng được
`pg_dump --data-only`; riêng `users` tạo từ `auth.users` (`encrypted_password` → `password_hash`,
gộp `is_super_admin` từ `profiles`). Hash bcrypt của Supabase dùng được ngay, người dùng giữ
nguyên mật khẩu (đã có test kiểm chứng).

## Mở rộng khi tải tăng

Xem `SCALING.md` ở thư mục gốc: hiện trạng, giới hạn đã biết, cách đo, và các bước theo từng giai đoạn (nhiều instance, pooler, Redis cho giới hạn request, tối ưu database).

## Lộ trình

- [x] Khung dự án, config, migration, xử lý lỗi, test tích hợp
- [x] Xác thực (đăng ký, đăng nhập, refresh xoay vòng, đăng xuất, quên/đặt lại/đổi mật khẩu)
- [x] Chủ đề + từ vựng (kèm luật quyền chủ đề cá nhân / chủ đề nhóm)
- [x] Tiến trình học (word_progress), review_log, user_settings
- [x] Câu giao tiếp
- [x] Nhóm học tập (tạo nhóm, tham gia, mã mời, thành viên, dashboard tiến độ)
- [x] Đổi lớp `src/api/` của FE sang gọi BE này
- [x] `render.yaml` + hướng dẫn deploy (`DEPLOY.md`)
- [x] Quản lý tài khoản (thiết bị đang đăng nhập, xoá tài khoản), mật khẩu mới tối thiểu 8 ký tự
- [x] Chuyển quyền trưởng nhóm; nhóm không bao giờ mất trưởng nhóm
- [x] Phân trang `GET /words`, `GET /progress`; nhận giờ ôn thật khi FE đồng bộ kết quả học lúc mất mạng
- [x] Cài đặt cho kiểu học tranh thủ: cỡ phiên, mục tiêu ngày, giới hạn thẻ ôn lại mỗi ngày
- [x] Vai trò toàn hệ thống (user / admin / super admin), API quản trị tài khoản, khoá tài khoản
- [x] Nền tảng để mở rộng: log request, nén phản hồi, dọn dẹp định kỳ, thống kê nhóm tính trong DB, kết nối tách riêng cho migration, kho đếm giới hạn request thay được (`SCALING.md`)
- [ ] Xác minh email khi đăng ký
- [ ] CI chạy lint + test khi đưa code lên GitHub
