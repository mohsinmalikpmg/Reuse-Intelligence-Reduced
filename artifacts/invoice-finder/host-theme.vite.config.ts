/**
 * Host wrapper: loads this artifact's original vite.config.ts unchanged and adds the shared
 * FUSEBOX theme plugin (scripts/theme). Point dev/build/serve at this file:
 *   vite --config host-theme.vite.config.ts
 */
import { defineConfig, mergeConfig, type UserConfig, type ConfigEnv, type UserConfigExport } from "vite";
import original from "./vite.config";
import { fuseboxTheme } from "../../scripts/theme/vite-plugin-fusebox-theme";

export default defineConfig(async (env: ConfigEnv) => {
  const exp = original as UserConfigExport;
  const base: UserConfig = await (typeof exp === "function" ? exp(env) : exp);
  return mergeConfig(base, {
    plugins: [fuseboxTheme({ app: "invoice-finder", floatingToggle: true, darkBackground: "hsl(41 19% 15%)", lightBackground: "#f2ede2" })],
  });
});
