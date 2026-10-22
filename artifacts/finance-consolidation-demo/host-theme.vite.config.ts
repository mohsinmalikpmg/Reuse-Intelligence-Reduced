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
    plugins: [fuseboxTheme({ app: "finance-consolidation-demo", floatingToggle: true, darkBackground: "hsl(222 30% 9%)", lightBackground: "hsl(40 33% 96%)" })],
  });
});
