import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globalSetup: './test/globalSetup.js',
    // Các file test dùng chung 1 database test → chạy tuần tự để không xoá dữ liệu của nhau.
    fileParallelism: false,
    testTimeout: 15_000,
  },
})
