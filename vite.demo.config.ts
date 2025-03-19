import { defineConfig } from "vite";
import { resolve } from "path";

// Kiểm tra môi trường build
const isProd = process.env.NODE_ENV === "production";

// Cấu hình cho ứng dụng demo
export default defineConfig({
  build: {
    outDir: "dist/demo",
    sourcemap: !isProd,
    minify: isProd ? "terser" : false,
    terserOptions: isProd
      ? {
          compress: {
            drop_console: true,
            drop_debugger: true,
            pure_funcs: [
              "console.log",
              "console.info",
              "console.debug",
              "console.trace",
            ],
            passes: 2,
            ecma: 2020,
          },
          format: {
            comments: false,
            ecma: 2020,
          },
          mangle: {
            properties: {
              regex: /^_/,
            },
          },
          ecma: 2020,
        }
      : undefined,
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        demo: resolve(__dirname, "src/demo/index.html"),
      },
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
});
