export function iframeCode(
  origin: string,
  slug: string,
  title: string,
): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  return `<iframe src="${escape(`${origin}/embed/${encodeURIComponent(slug)}`)}" title="${escape(title)}" width="100%" height="600" loading="lazy" sandbox="allow-scripts allow-same-origin" allowfullscreen style="border:0"></iframe>`;
}
