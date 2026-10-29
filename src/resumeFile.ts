import { getUrl, remove, uploadData } from "aws-amplify/storage";

// Resumes are stored privately in S3 under resumes/<identityId>/.
// One file per user: uploading a new resume replaces the old one.
const resumePath = ({ identityId }: { identityId?: string }) => `resumes/${identityId}/resume`;

export const MAX_RESUME_BYTES = 5 * 1024 * 1024;
export const ACCEPTED_TYPES = ["application/pdf", "text/plain"];

export async function uploadResume(file: File): Promise<void> {
  await uploadData({
    path: resumePath,
    data: file,
    options: {
      contentType: file.type || "application/octet-stream",
      contentDisposition: `inline; filename="${file.name.replace(/"/g, "")}"`,
    },
  }).result;
}

// A short-lived signed link, so the file is never publicly readable.
export async function resumeDownloadUrl(): Promise<string> {
  const { url } = await getUrl({ path: resumePath, options: { expiresIn: 300 } });
  return url.toString();
}

export async function deleteResume(): Promise<void> {
  await remove({ path: resumePath });
}

// Reads the text out of a PDF in the browser, keeping line breaks.
async function pdfToText(file: File): Promise<string> {
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const doc = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent();
    let text = "";
    for (const item of content.items) {
      if ("str" in item) text += item.str + (item.hasEOL ? "\n" : " ");
    }
    pages.push(text);
  }
  return pages.join("\n\n");
}

export async function extractResumeText(file: File): Promise<string> {
  const raw = file.type === "application/pdf" ? await pdfToText(file) : await file.text();
  return raw
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Removes email addresses and phone numbers before the text is sent to the AI.
// They aren't needed for matching, and a resume often includes other people's
// contact details (references).
export function redactContactInfo(text: string): { text: string; removed: number } {
  let removed = 0;
  const count = () => {
    removed++;
    return "[removed]";
  };
  const cleaned = text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, count)
    .replace(/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, count);
  return { text: cleaned, removed };
}