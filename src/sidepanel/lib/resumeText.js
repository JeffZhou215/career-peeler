import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

GlobalWorkerOptions.workerSrc = workerUrl;

export async function extractPdfText(dataUrl) {
  const encoded = String(dataUrl).split(",")[1];
  if (!encoded) throw new Error("The saved PDF could not be read.");
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const task = getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: true });
  try {
    const document = await task.promise;
    const pages = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      pages.push(content.items.filter((item) => "str" in item)
        .map((item) => item.str + (item.hasEOL ? "\n" : " ")).join(""));
    }
    const text = pages.join("\n\n").trim();
    if (text.length < 40) throw new Error("This PDF has no readable text layer. Extract the candidate profile with AI Matching to use it.");
    return text;
  } finally {
    await task.destroy();
  }
}
