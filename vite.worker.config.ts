import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";
  console.log("Building in mode:", mode);

  return {
    build: {
      outDir: "dist",
      emptyOutDir: false,
      sourcemap: !isProd,
      minify: isProd ? "terser" : false,
      terserOptions: isProd
        ? {
            compress: {
              drop_console: true, // Xóa console.log
            },
            mangle: true, // Đổi tên biến
            output: {
              comments: false, // Xóa comment
            },
          }
        : {},
      lib: {
        entry: resolve(__dirname, "src/worker/index.ts"),
        name: "SipWorker",
        fileName(format, entryName) {
          return `worker.${format}.js`;
        },
        formats: ["es", "iife"],
      },
    },
    resolve: {
      alias: {
        "@worker": resolve(__dirname, "src/worker"),
        "@client": resolve(__dirname, "src/client"),
        "@demo": resolve(__dirname, "src/demo"),
      },
    },
    define: {
      __PROD__: isProd,
      __VERSION__: JSON.stringify(process.env.npm_package_version || "0.0.0"),
    },
  };
});
