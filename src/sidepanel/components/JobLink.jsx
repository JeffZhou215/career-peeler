import { cleanJobTitle } from "../lib/format";

export function JobLink({ jobId, title, url }) {
  const legacyUrl = typeof jobId === "string" && jobId.startsWith("http") ? jobId : null;
  const displayJobId = legacyUrl ? null : jobId;
  const linkUrl = url || legacyUrl;
  const label = `${displayJobId ? `Role ${displayJobId}` : "Role unknown"}${title ? ` - ${cleanJobTitle(title)}` : ""}`;

  if (!linkUrl) {
    return label;
  }

  return (
    <a href={linkUrl} target="_blank" rel="noopener noreferrer">
      {label}
    </a>
  );
}
