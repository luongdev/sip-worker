import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig(({ mode }) => {
  const isProd = mode === "production";

  return {
    build: {
      outDir: "dist",
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
      lib: {
        entry: resolve(__dirname, "src/client/index.ts"),
        name: "SipClient",
        fileName: "sip-client",
      },
      rollupOptions: {
        output: {
          globals: {
            "sip.js": "SIP",
          },
          format: ["es"],
        },
        // Loại trừ thư mục demo khỏi quá trình build
        external: [/src\/demo\/.*/, "sip.js"],
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
