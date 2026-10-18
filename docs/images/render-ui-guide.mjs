// Documentation illustration with synthetic data; never reads Chrome or Apple.
// Run from the repository root: node docs/images/render-ui-guide.mjs
import { readFile, writeFile } from "node:fs/promises";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const width = 1140, height = 1056;
const colors = { white: "#f5f5f7", muted: "#a6a6b0", blue: "#0a84ff", border: "#38383c", panel: "#101012", surface: "#1c1c1e", subtle: "#2c2c2e" };
const parts = [];
const iconSvg = await readFile(new URL("../../icons/icon128.svg", import.meta.url), "utf8");
const iconViewBox = iconSvg.match(/viewBox="([^"]+)"/)?.[1];
const iconContents = iconSvg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1];
if (!iconViewBox || !iconContents) throw new Error("Rolebeam icon must be a complete SVG with a viewBox");
const escape = value => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
function text(x, y, value, size = 13, color = colors.white, bold = false, anchor = "start") {
  parts.push(`<text x="${x}" y="${y + size}" font-size="${size}" fill="${color}" font-weight="${bold ? 600 : 400}" text-anchor="${anchor}">${escape(value)}</text>`);
}
function box(x, y, w, h, fill = colors.surface, stroke = "none", radius = 8) {
  parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}"/>`);
}
function line(x, y, w) { parts.push(`<path d="M${x} ${y}h${w}" stroke="${colors.border}"/>`); }
function chevron(x, y) { parts.push(`<path d="M${x} ${y}l4 4 4-4" fill="none" stroke="${colors.muted}" stroke-width="1.3"/>`); }
function help(x, y) {
  parts.push(`<circle cx="${x + 6}" cy="${y + 6}" r="6" fill="none" stroke="${colors.muted}"/>`);
  text(x + 6, y, "?", 10, colors.muted, false, "middle");
}
function button(x, y, w, value, primary = false, size = 12, h = 34) {
  box(x, y, w, h, primary ? colors.blue : colors.surface, primary ? "none" : colors.border, 7);
  text(x + w / 2, y + (h - size) / 2 - 1, value, size, primary ? colors.white : colors.blue, true, "middle");
}
function field(x, y, w, value, size = 12) { box(x, y, w, 34, colors.surface, colors.border, 7); text(x + 10, y + 9, value, size, colors.muted); }
function check(x, y, selected = false, protectedRole = false) {
  box(x, y, 13, 13, selected ? colors.blue : "#242426", selected ? "none" : protectedRole ? colors.border : "#909097", 3);
  if (selected) parts.push(`<path d="M${x + 3} ${y + 6}l3 3 5-6" fill="none" stroke="${colors.white}" stroke-width="2"/>`);
}
function tabIcon(x, y, name, active) {
  const path = name === "Jobs" ? "M2 5h16v13H2zM7 5V2h6v3M2 10h16M8 10v3h4v-3"
    : name === "Submissions" ? "M1 4l2 2 3-4M1 10l2 2 3-4M1 16l2 2 3-4M9 4h10M9 10h10M9 16h10"
      : "M10 9a4 4 0 1 0 0-8 4 4 0 0 0 0 8M2 20v-2a8 8 0 0 1 16 0v2";
  parts.push(`<path d="${path}" transform="translate(${x} ${y})" fill="none" stroke="${active ? colors.blue : colors.muted}" stroke-width="1.4"/>`);
}
function panel(x, step, label, active) {
  box(x, 88, 27, 27, colors.blue, "none", 14);
  text(x + 13.5, 91, step, 16, colors.white, true, "middle");
  text(x + 38, 92, label, 17, "#22242a", true);
  box(x, 132, 344, 836, colors.panel, "none", 16);
  const left = x + 16;
  parts.push(`<svg x="${left}" y="156" width="32" height="32" viewBox="${iconViewBox}">${iconContents}</svg>`);
  text(left + 44, 150, "ROLEBEAM", 10, colors.muted, true);
  text(left + 44, 171, "Apple Careers", 23, colors.white, true);
  box(left, 211, 312, 61, colors.subtle, "none", 8);
  for (const [offset, label, value] of [[9, "Submitted", "4 / 50"], [109, "Available Slots", "46"], [208, "Application Queue", "1 Job"]]) {
    text(left + offset, 221, label, 9, colors.muted);
    text(left + offset, 242, value, 12, colors.white, true);
  }
  help(left + 291, 236);
  line(left, 914, 312);
  for (const [offset, name] of [[0, "Jobs"], [104, "Submissions"], [208, "Setup"]]) {
    tabIcon(left + offset + 43, 926, name, name === active);
    text(left + offset + 52, 949, name, 11, name === active ? colors.blue : colors.muted, true, "middle");
  }
  return left;
}
function roleCard(x, y, title, id, status, score, { selected = false, protectedRole = false, unscored = false } = {}) {
  box(x, y, 312, 62, colors.surface, "none", 7);
  if (!protectedRole) check(x + 9, y + 13, selected);
  const titleX = x + (protectedRole ? 12 : 31);
  text(titleX, y + 9, title, 12, colors.white, true);
  text(x + 286, y + 9, unscored ? "Unscored" : `${score}%`, 12, colors.white, true, "end");
  text(x + 298, y + 25, "›", 17, colors.muted);
  text(titleX, y + 32, `${id} · ${status}`, 10, colors.muted);
}

box(0, 0, width, height, "#eef1f6", "none", 0);
text(24, 22, "Rolebeam · Your Apple Careers Workflow", 29, "#16171b", true);
text(24, 61, "Upload a PDF. Choose applications. Manage submissions as one collection.", 16, "#626672");

let x = panel(24, "1", "Prepare Your Resume", "Setup");
text(x, 291, "Your Resume", 15, colors.white, true); help(x + 103, 294);
box(x, 322, 312, 126);
text(x + 12, 334, "Example Resume.pdf", 12, colors.white, true);
text(x + 12, 355, "Text Ready", 11, colors.muted);
button(x + 218, 332, 82, "Replace", false, 11);
line(x + 12, 381, 288);
text(x + 12, 390, "›  Parsed Resume Text", 12, colors.muted);
button(x + 12, 416, 288, "Extract Profile From Resume", false, 11, 26);
text(x, 474, "AI Matching", 15, colors.white, true); help(x + 93, 477);
box(x, 505, 312, 200);
check(x + 12, 519, true); text(x + 34, 516, "Enable LLM Matching", 12);
text(x + 12, 549, "OpenAI API Key", 11, colors.muted, true);
field(x + 12, 569, 288, "••••••••••••••••");
button(x + 12, 615, 135, "Test API Key", false, 11, 28);
text(x + 172, 621, "Valid", 11, colors.muted);
text(x + 12, 659, "Model", 11, colors.muted, true);
field(x + 70, 651, 230, "gpt-4o", 12);
box(x, 727, 312, 37); text(x + 12, 738, "›  Application Profile", 12, colors.white, true);
box(x, 778, 312, 37); text(x + 12, 789, "›  Matching Rules", 12, colors.white, true);

x = panel(398, "2", "Rank And Select Jobs", "Jobs");
text(x, 291, "Find Your Best Matches", 15, colors.white, true); help(x + 183, 294);
text(x, 319, "After Ranking", 11, colors.muted);
field(x, 337, 312, "Review Then Apply");
chevron(x + 286, 351);
button(x, 383, 312, "Scan And Rank", true);
text(x, 430, "Rankings Saved", 12, colors.white, true);
text(x, 450, "2 Saved · 2 Strong Matches", 10, colors.muted);
field(x, 476, 312, "Find Job ID Or Title");
chevron(x, 536); text(x + 14, 529, "Ranked Jobs", 12, colors.white, true); text(x + 276, 529, "1 Job", 10, colors.muted);
text(x, 555, "View", 10, colors.muted); text(x + 236, 555, "Top", 10, colors.muted);
box(x + 265, 550, 47, 27, colors.surface, colors.border, 6); text(x + 276, 556, "12", 11);
field(x, 588, 312, "Top Matches");
roleCard(x, 634, "Example AI Engineer", "200000101", "Strong Match · Latest Scan", 94);
button(x, 708, 312, "Queue Top 1");
line(x, 757, 312);
chevron(x, 775); text(x + 14, 768, "Application Queue", 12, colors.white, true); text(x + 267, 768, "1 Job", 10, colors.muted);
button(x, 795, 150, "Select All", false, 11, 27); button(x + 162, 795, 150, "Clear Selection", false, 11, 27);
text(x, 830, "1 Selected · 45 Slots Remaining", 10, colors.muted);
check(x + 9, 853, true); text(x + 31, 850, "Example ML Engineer", 11, colors.white, true);
text(x + 287, 850, "90%", 11, colors.white, true, "end");
text(x + 31, 868, "200000102 · Queued · Strong Match", 9, colors.muted);
button(x, 890, 312, "Apply Selected (1)", true, 12, 22);

x = panel(772, "3", "Review Submissions", "Submissions");
text(x, 291, "Review Your Submissions", 15, colors.white, true); help(x + 194, 294);
text(x, 325, "Synced just now", 11, colors.muted);
text(x, 344, "Verified 1:30 AM", 10, colors.muted);
button(x, 376, 154, "Analyze & Rank All", true, 11);
button(x + 162, 376, 150, "Sync Submissions", false, 11);
box(x, 428, 312, 32, colors.subtle, "none", 7);
for (const [index, value] of ["All", "Scored", "Unscored", "Protected"].entries()) {
  if (index === 0) box(x + 3, 431, 73, 26, colors.surface, "none", 5);
  text(x + index * 77 + 40, 436, value, 10, colors.white, false, "middle");
}
field(x, 477, 312, "Find Job ID Or Title");
text(x, 531, "Submitted Roles", 12, colors.white, true);
text(x + 234, 532, "Lowest Fit First", 10, colors.muted);
roleCard(x, 559, "Example Role To Review", "200000201", "Submitted", 40);
roleCard(x, 633, "Example Software Role", "200000202", "Submitted", 81);
roleCard(x, 707, "Example Unscored Role", "200000203", "Submitted", null, { unscored: true });
roleCard(x, 781, "Example Protected Role", "200000204", "Starred · Protected", 92, { protectedRole: true });
text(x, 871, "0 Selected", 11, colors.muted);
box(x + 105, 861, 207, 34, "#623331", "none", 7);
text(x + 208.5, 870, "Review Withdrawal", 12, "#be8984", true, "middle");

text(24, 1001, "Illustration · Fictional Roles, Counts And Sync Time", 12, "#626672");
text(676, 1001, "Expand roles for details. Use ? for help.", 12, "#626672");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description"><title id="title">Rolebeam: Setup, Jobs and Submissions</title><desc id="description">Illustration of labeled capacity metrics, PDF setup, reviewed application selection, and one unified submissions collection with sync status and status filters. All data is fictional.</desc><g font-family="Arial, Helvetica, sans-serif">${parts.join("\n")}</g></svg>`;
await writeFile(new URL("./ui-guide.svg", import.meta.url), svg);
const canvas = createCanvas(width * 2, height * 2);
const rasterSvg = svg.replace(`width="${width}" height="${height}"`, `width="${width * 2}" height="${height * 2}"`);
canvas.getContext("2d").drawImage(await loadImage(Buffer.from(rasterSvg)), 0, 0, width * 2, height * 2);
await writeFile(new URL("./ui-guide.png", import.meta.url), canvas.toBuffer("image/png"));
console.log("Updated docs/images/ui-guide.svg and ui-guide.png");
