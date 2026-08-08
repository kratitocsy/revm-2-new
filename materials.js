/* materials.js — group study-materials upload & compression
 * Requires on the page:
 *   - `sb` (supabase client), already created as in groups.html
 *   - pdf.js, loaded before this file:
 *       <script src="https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.min.js"></script>
 *       <script>pdfjsLib.GlobalWorkerOptions.workerSrc =
 *         "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";</script>
 *
 * Everything here converts the source file into a sequence of already-
 * compressed JPEG "pages" before anything is uploaded — a PDF is rasterized
 * page-by-page via pdf.js, a plain image is just resized/recompressed as a
 * single page. The reader never has to open a native PDF, which keeps the
 * viewer simple and avoids exposing a browser PDF UI (save/print) later.
 */

const MATERIALS_WORKER_URL = 'https://revm2-materials-proxy.kiaro2244.workers.dev';
const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB raw-file cap, tune as needed
const PAGE_RENDER_SCALE = 2.0;   // ~200dpi equivalent - keeps small text/equations legible
const PAGE_MAX_DIM = 1800;       // cap on long edge for plain image uploads (trimmed from 2000 for storage)
const JPEG_QUALITY = 0.80;       // trimmed from 0.85 for storage; still above visible-artifact threshold on text edges

/** Page bytes go straight to B2 via the worker — never through Supabase Storage. */
async function uploadPageToWorker(groupId, materialId, pageNumber, blob) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) throw new Error('Not signed in.');
  const url = `${MATERIALS_WORKER_URL}/upload?group_id=${encodeURIComponent(groupId)}&material_id=${encodeURIComponent(materialId)}&page=${pageNumber}&ext=jpg`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'image/jpeg' },
    body: blob,
  });
  if (!res.ok) throw new Error(`Page ${pageNumber} upload failed (${res.status}).`);
  return res.json();
}

/** Compress a plain image file into a single JPEG page blob. */
function compressImagePage(file, maxDim = PAGE_MAX_DIM, quality = JPEG_QUALITY) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > height && width > maxDim) { height = Math.round(height * maxDim / width); width = maxDim; }
      else if (height > maxDim) { width = Math.round(width * maxDim / height); height = maxDim; }
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(img, 0, 0, width, height);
      canvas.toBlob(blob => {
        URL.revokeObjectURL(img.src);
        resolve({ blob, width, height });
      }, 'image/jpeg', quality);
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

/** Rasterize every page of a PDF file into an array of JPEG page blobs. */
async function rasterizePdfPages(file, onProgress) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: PAGE_RENDER_SCALE });
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', JPEG_QUALITY));
    pages.push({ blob, width: canvas.width, height: canvas.height });
    if (onProgress) onProgress(i, pdf.numPages);
    canvas.width = canvas.height = 0; // free memory before the next page
  }
  return pages;
}

/**
 * Upload a material for a group. Caller is responsible for having already
 * confirmed the current user is an admin of `groupId` (RLS enforces it
 * server-side regardless, this just avoids a wasted upload on failure).
 *
 * @param {string} groupId
 * @param {File} file        - a .pdf or an image file
 * @param {string} title
 * @param {(status:string)=>void} onStatus - optional progress callback
 */
async function uploadGroupMaterial(groupId, file, title, onStatus = () => {}) {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`File is ${(file.size / 1024 / 1024).toFixed(1)}MB — limit is ${MAX_UPLOAD_BYTES / 1024 / 1024}MB.`);
  }
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  const isImage = file.type.startsWith('image/');
  if (!isPdf && !isImage) throw new Error('Only PDF or image files are supported.');

  onStatus('Compressing…');
  const pages = isPdf
    ? await rasterizePdfPages(file, (done, total) => onStatus(`Compressing page ${done}/${total}…`))
    : [await compressImagePage(file)];

  const compressedSize = pages.reduce((sum, p) => sum + p.blob.size, 0);

  onStatus('Saving…');
  const { data: materialRow, error: insertErr } = await sb.from('group_materials').insert({
    group_id: groupId,
    uploaded_by: (await sb.auth.getUser()).data.user.id,
    title,
    source_type: isPdf ? 'pdf' : 'image',
    page_count: pages.length,
    original_size_bytes: file.size,
    compressed_size_bytes: compressedSize,
    status: 'processing',
  }).select('id').single();
  if (insertErr) throw insertErr;
  const materialId = materialRow.id;

  try {
    onStatus('Uploading pages…');
    for (let i = 0; i < pages.length; i++) {
      const pageNumber = i + 1;
      const { key: path } = await uploadPageToWorker(groupId, materialId, pageNumber, pages[i].blob);
      const { error: pageErr } = await sb.from('group_material_pages').insert({
        material_id: materialId,
        page_number: i + 1,
        storage_path: path,
        width: pages[i].width,
        height: pages[i].height,
      });
      if (pageErr) throw pageErr;
      onStatus(`Uploading pages… ${i + 1}/${pages.length}`);
    }
    await sb.from('group_materials').update({ status: 'ready' }).eq('id', materialId);
    onStatus('Done.');
    return materialId;
  } catch (e) {
    await sb.from('group_materials').update({ status: 'failed' }).eq('id', materialId);
    throw e;
  }
}

/** List ready materials for a group (any member can call — RLS-gated). */
async function listGroupMaterials(groupId) {
  const { data, error } = await sb.from('group_materials')
    .select('id, title, source_type, page_count, status, created_at, uploaded_by')
    .eq('group_id', groupId)
    .eq('status', 'ready')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

/* ── ZIP ARCHIVES ──────────────────────────────────────────────────
 * Requires JSZip on the page:
 *   <script src="https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js"></script>
 * A .zip is just expanded client-side into its PDF/image entries, each
 * of which then flows through the normal single-file upload pipeline.
 */
const ZIP_ENTRY_RE = /\.(pdf|jpe?g|png|webp)$/i;

function isZipFile(file) {
  return /\.zip$/i.test(file.name) || file.type === 'application/zip' || file.type === 'application/x-zip-compressed';
}

/** Expand a .zip File into an array of File objects for its PDF/image entries. */
async function extractFilesFromZip(zipFile) {
  if (typeof JSZip === 'undefined') {
    throw new Error('ZIP support failed to load — refresh the page and try again.');
  }
  const zip = await JSZip.loadAsync(zipFile);
  const entries = Object.values(zip.files)
    .filter(e => !e.dir
      && !e.name.startsWith('__MACOSX/')
      && !e.name.split('/').pop().startsWith('.')
      && ZIP_ENTRY_RE.test(e.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  if (!entries.length) throw new Error(`No PDF or image files found inside "${zipFile.name}".`);
  const out = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    const name = entry.name.split('/').pop();
    const ext = name.split('.').pop().toLowerCase();
    const type = ext === 'pdf' ? 'application/pdf' : `image/${ext === 'jpg' ? 'jpeg' : ext}`;
    out.push(new File([blob], name, { type }));
  }
  return out;
}

/* ── BATCH UPLOAD ─────────────────────────────────────────────────
 * Accepts a mix of plain PDFs/images and .zip archives (which are
 * transparently expanded first) and uploads each as its own material,
 * so the caller never has to drive the file picker one file at a time.
 *
 * @param {string} groupId
 * @param {File[]} files
 * @param {(status:string)=>void} onStatus
 * @param {(file:File)=>string} [titleFor] - defaults to the filename minus extension
 * @returns {Promise<{results:string[], errors:{file:string,error:string}[]}>}
 */
async function uploadGroupMaterials(groupId, files, onStatus = () => {}, titleFor = null) {
  const expanded = [];
  for (const f of files) {
    if (isZipFile(f)) {
      onStatus(`Unzipping ${f.name}…`);
      expanded.push(...await extractFilesFromZip(f));
    } else {
      expanded.push(f);
    }
  }

  const results = [];
  const errors = [];
  for (let i = 0; i < expanded.length; i++) {
    const file = expanded[i];
    const title = (titleFor ? titleFor(file) : null) || file.name.replace(/\.[^.]+$/, '');
    const prefix = expanded.length > 1 ? `(${i + 1}/${expanded.length}) ${title}: ` : '';
    try {
      const materialId = await uploadGroupMaterial(groupId, file, title, (s) => onStatus(prefix + s));
      results.push(materialId);
    } catch (e) {
      console.error(`Failed to upload ${file.name}:`, e);
      errors.push({ file: file.name, error: e.message || String(e) });
    }
  }
  onStatus(errors.length
    ? `Done — ${results.length} uploaded, ${errors.length} failed.`
    : `Done — ${results.length} uploaded.`);
  return { results, errors };
}

/* ── GOOGLE DRIVE IMPORT ──────────────────────────────────────────
 * The picker UI itself (auth + file selection) lives on the page, since
 * it needs Google's Identity Services + Picker scripts and a client ID.
 * This just turns a picked Drive file into a File object once the page
 * already has a fileId/accessToken, so it can flow into uploadGroupMaterials.
 */
async function fetchDriveFileAsFile(fileId, fileName, mimeType, accessToken) {
  const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Could not download "${fileName}" from Drive (${res.status}).`);
  const blob = await res.blob();
  return new File([blob], fileName, { type: mimeType || blob.type || 'application/octet-stream' });
}

window.RevmMaterials = {
  uploadGroupMaterial,
  uploadGroupMaterials,
  extractFilesFromZip,
  isZipFile,
  fetchDriveFileAsFile,
  listGroupMaterials,
  MAX_UPLOAD_BYTES,
};
