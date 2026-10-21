/** Validation only. Never fetch user-supplied URLs or infer a deployment address. */
export function validateExportLinks(workspaceUrl: string, publishedUrl: string) {
  const parse = (value: string) => {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash) throw new Error("Use an HTTPS URL without credentials, port, query or fragment.");
    return url;
  };
  const workspace = workspaceUrl.trim();
  const published = publishedUrl.trim();
  if (!workspace && published) throw new Error("Save a workspace URL before a published URL.");
  if (workspace) {
    const u = parse(workspace);
    if (u.hostname !== "replit.com" || !/^\/(?:@[\w-]+|t\/[\w-]+)\/[\w-]+\/?$/.test(u.pathname)) throw new Error("Use a Replit workspace URL: https://replit.com/@owner/app or https://replit.com/t/team/app.");
  }
  if (published) {
    const u = parse(published);
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.replit\.app$/.test(u.hostname) || u.pathname !== "/") throw new Error("Use the explicitly published HTTPS address on replit.app, not a preview address.");
  }
  return { workspaceUrl: workspace, publishedUrl: published };
}
