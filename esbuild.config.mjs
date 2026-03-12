import { build } from "esbuild";
import { nodeExternalsPlugin } from "esbuild-node-externals";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  outdir: "dist",
  plugins: [nodeExternalsPlugin({
    allowList: ["@itwin/itwins-client"],
  })],
  sourcemap: true,
  target: "node22",
  outExtension: { ".js": ".mjs" },
  external: ["axios", "@itwin/imodels-client-management"],
  loader: { ".md": "text" }
});