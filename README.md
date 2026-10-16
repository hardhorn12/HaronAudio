# PNTT Player

Website tĩnh nghe truyện từ Hugging Face Dataset `haron2571/pntt_gvn`.

## 1. Đặt playlist
Đặt hai file JSON thực tế của bạn vào:
- `playlists/playlist_P1.json`
- `playlists/playlist_P2.json`

Mỗi file phải là mảng JSON; mỗi tập cần ít nhất trường `src`. Các trường `id`, `title`, `part`, `chapter_start`, `chapter_end` được khuyến nghị.

## 2. Chạy thử trên máy tính
Không nên mở `index.html` bằng `file://` vì trình duyệt có thể chặn `fetch()` JSON. Dùng Python trong thư mục này:

```bat
py -m http.server 8000
```

Mở `http://localhost:8000`.

## 3. Đưa lên GitHub Pages
1. Tạo repository mới trên GitHub, ví dụ `pntt-player`.
2. Giải nén dự án và sao chép toàn bộ nội dung thư mục `PNTT-Player` vào repository.
3. Đưa hai playlist JSON thật vào thư mục `playlists`.
4. Commit và push lên nhánh `main`.
5. Vào **Settings → Pages**.
6. Ở **Build and deployment**, chọn **Deploy from a branch**, chọn `main` và `/(root)`, bấm **Save**.
7. Chờ GitHub Actions hoàn thành. URL thường có dạng `https://TEN-GITHUB.github.io/pntt-player/`.

## QUAN TRỌNG: quyền riêng tư
GitHub Pages trên gói cá nhân thông thường không cung cấp đăng nhập/mật khẩu để bảo vệ một website riêng tư. Mã khóa JavaScript phía trình duyệt không phải bảo mật thật: người khác vẫn có thể xem mã nguồn và URL audio.
- Nếu chỉ muốn tránh người khác tình cờ biết link: repo/site công khai có thể phù hợp, nhưng không được xem là riêng tư.
- Nếu bắt buộc chỉ mình bạn được truy cập: dùng GitHub Enterprise Cloud với Pages riêng tư theo điều kiện của GitHub, hoặc chọn nền tảng có lớp xác thực thật (ví dụ Cloudflare Access với cấu hình domain phù hợp). Không đưa mật khẩu hay token vào JavaScript.
- Dataset công khai thì file audio cũng có thể được truy cập trực tiếp bởi bất kỳ ai có URL. Muốn bảo vệ cả audio, cần kiểm soát quyền truy cập ở nơi lưu audio; chỉ khóa website là chưa đủ.

## Ghi chú phát audio
Website không tải hàng chục GB về cùng lúc. Trình duyệt chỉ yêu cầu file khi chọn phát. Khả năng phát/tua `.opus` phụ thuộc trình duyệt và cách máy chủ phục vụ file.
