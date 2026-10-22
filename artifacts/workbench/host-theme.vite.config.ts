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
    plugins: [fuseboxTheme({ app: "workbench", floatingToggle: false, darkBackground: "hsl(199 45% 7%)", lightBackground: "hsl(90 11% 97%)" })],
  });
});
