export const config = { maxDuration: 30 };

// ── Upstash KV helpers (raw REST — @vercel/kv is not installed) ──────────────
async function kvSet(key, value) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV env vars not configured');
  const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  });
  if (!res.ok) throw new Error(`KV set failed: ${res.status}`);
  return res.json();
}

async function kvList(prefix) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV env vars not configured');
  const res = await fetch(`${url}/keys/${encodeURIComponent(prefix + '*')}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV list failed: ${res.status}`);
  const data = await res.json();
  return data.result || [];
}

async function kvGet(key) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) throw new Error('KV env vars not configured');
  const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`KV get failed: ${res.status}`);
  const data = await res.json();
  return data.result;
}

// ── docx generation ───────────────────────────────────────────────────────────
// Uses the docx npm package (must be in package.json)
async function buildDocx(title, articleText) {
  const {
    Document, Packer, Paragraph, TextRun, HeadingLevel,
    BorderStyle, ShadingType, AlignmentType, ExternalHyperlink,
  } = await import('docx');

  const PRIMARY_BLUE = '1D4A7A';
  const LIGHT_BLUE   = '55B8D8';
  const GOLD         = 'C9963A';
  const OLIVE        = '449D80';
  const PINK         = 'CC5B9C';
  const INK          = '1A1A1A';
  const MID          = '555555';

  function fmt(opts = {}) {
    return {
      font: 'IBM Plex Sans',
      size: opts.size || 22,
      bold: opts.bold || false,
      color: opts.color || INK,
      italics: opts.italics || false,
    };
  }

  function rule(color = PRIMARY_BLUE) {
    return new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color, space: 1 } },
      spacing: { after: 0 }, children: [],
    });
  }

  function spacer(pts = 120) {
    return new Paragraph({ spacing: { before: pts, after: 0 }, children: [] });
  }

  const children = [];

  // Split on the LinkedIn précis divider
  const divIdx = articleText.search(/\n---+\n/);
  const body   = divIdx > -1 ? articleText.slice(0, divIdx).trim() : articleText.trim();
  const précis = divIdx > -1 ? articleText.slice(divIdx).replace(/^---+\n?/,'').replace(/^LINKEDIN PR[EÉ]CIS[:\s]*/i,'').trim() : '';

  // Timestamp meta
  children.push(new Paragraph({
    alignment: AlignmentType.LEFT,
    spacing: { before: 0, after: 60 },
    children: [new TextRun({
      text: `Guest Guide Interactive  ·  Saved ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`,
      font: 'IBM Plex Mono', size: 17, color: '888888',
    })],
  }));
  children.push(spacer(80));
  children.push(rule(PRIMARY_BLUE));
  children.push(spacer(160));

  // Process body lines
  const lines = body.split('\n');
  let para = [];
  let inImageBlock = false;
  let imgLines = [];

  function flushPara() {
    if (para.length === 0) return;
    const text = para.join(' ').trim();
    if (!text) { para = []; return; }
    children.push(new Paragraph({
      spacing: { before: 0, after: 180 },
      children: [new TextRun({ text, font: 'IBM Plex Sans', size: 22, color: INK })],
    }));
    para = [];
  }

  function flushImageBlock() {
    if (imgLines.length === 0) return;
    const raw = imgLines.join('\n');
    const labelM = raw.match(/^IMAGE\s+\d+\s*[—–-]\s*(.+)/m);
    const noteM  = raw.match(/Note:\s*(.+)/);
    const promptM= raw.match(/Prompt:\s*([\s\S]+?)(?=Note:|$)/);
    const label  = labelM ? labelM[1].trim() : 'Image';
    const note   = noteM  ? noteM[1].trim()  : '';
    const prompt = promptM? promptM[1].trim() : '';

    children.push(spacer(120));
    children.push(new Paragraph({
      spacing: { before: 0, after: 60 },
      shading: { fill: 'EBF6FA', type: ShadingType.CLEAR },
      border: {
        top:    { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
        left:   { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
        right:  { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
      },
      children: [
        new TextRun({ text: `[IMAGE: ${label}]`, font: 'IBM Plex Mono', size: 18, bold: true, color: PRIMARY_BLUE }),
      ],
    }));
    if (note) {
      children.push(new Paragraph({
        spacing: { before: 0, after: 40 },
        shading: { fill: 'EBF6FA', type: ShadingType.CLEAR },
        border: {
          left:  { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
          right: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
        },
        children: [new TextRun({ text: `Note: ${note}`, font: 'IBM Plex Sans', size: 18, italics: true, color: MID })],
      }));
    }
    if (prompt) {
      children.push(new Paragraph({
        spacing: { before: 0, after: 60 },
        shading: { fill: 'EBF6FA', type: ShadingType.CLEAR },
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
          left:   { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
          right:  { style: BorderStyle.SINGLE, size: 4, color: LIGHT_BLUE },
        },
        children: [new TextRun({ text: `Prompt: ${prompt}`, font: 'IBM Plex Mono', size: 17, color: '444444' })],
      }));
    }
    children.push(spacer(120));
    imgLines = [];
    inImageBlock = false;
  }

  for (const line of lines) {
    const trimmed = line.trim();

    // Image block start/end
    if (trimmed.startsWith(':::IMAGE') || trimmed.startsWith('::: IMAGE')) {
      flushPara();
      inImageBlock = true;
      imgLines = [trimmed.replace(/^:::\s*/, '')];
      continue;
    }
    if (inImageBlock) {
      if (trimmed === ':::') { flushImageBlock(); continue; }
      imgLines.push(trimmed);
      continue;
    }

    // H1
    if (trimmed.startsWith('# ')) {
      flushPara();
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_1,
        spacing: { before: 240, after: 120 },
        children: [new TextRun({ text: trimmed.slice(2), font: 'IBM Plex Sans', size: 40, bold: true, color: PRIMARY_BLUE })],
      }));
      continue;
    }
    // H2
    if (trimmed.startsWith('## ')) {
      flushPara();
      children.push(new Paragraph({
        heading: HeadingLevel.HEADING_2,
        spacing: { before: 300, after: 80 },
        children: [new TextRun({ text: trimmed.slice(3), font: 'IBM Plex Sans', size: 28, bold: true, color: PRIMARY_BLUE })],
      }));
      continue;
    }
    // Bullet
    if (trimmed.match(/^[-*]\s+/)) {
      flushPara();
      children.push(new Paragraph({
        bullet: { level: 0 },
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: trimmed.replace(/^[-*]\s+/, ''), font: 'IBM Plex Sans', size: 22, color: INK })],
      }));
      continue;
    }
    // Divider
    if (trimmed.match(/^---+$/)) {
      flushPara();
      children.push(spacer(200));
      children.push(rule(PINK));
      children.push(spacer(100));
      continue;
    }
    // Section label (LINKEDIN PRÉCIS)
    if (trimmed.match(/^LINKEDIN PR[EÉ]CIS/i)) {
      flushPara();
      children.push(new Paragraph({
        spacing: { before: 0, after: 80 },
        children: [new TextRun({ text: 'LINKEDIN PRÉCIS — copy and paste', font: 'IBM Plex Mono', size: 20, bold: true, color: PINK, allCaps: true })],
      }));
      continue;
    }
    // Blank line = paragraph break
    if (trimmed === '') {
      flushPara();
      continue;
    }
    // Accumulate paragraph text (strip markdown bold)
    para.push(trimmed.replace(/\*\*/g, '').replace(/\*/g, ''));
  }
  flushPara();
  if (inImageBlock) flushImageBlock();

  // Précis box
  if (précis) {
    children.push(spacer(160));
    children.push(rule(PINK));
    children.push(spacer(80));
    children.push(new Paragraph({
      spacing: { before: 0, after: 80 },
      children: [new TextRun({ text: 'LINKEDIN PRÉCIS — copy and paste', font: 'IBM Plex Mono', size: 20, bold: true, color: PINK, allCaps: true })],
    }));
    children.push(new Paragraph({
      spacing: { before: 0, after: 0 },
      shading: { fill: 'FDF0F7', type: ShadingType.CLEAR },
      border: { left: { style: BorderStyle.SINGLE, size: 12, color: PINK } },
      children: [new TextRun({ text: précis, font: 'IBM Plex Sans', size: 21, color: '333333' })],
    }));
  }

  const doc = new Document({
    styles: {
      default: { document: { run: { font: 'IBM Plex Sans', size: 22 } } },
      paragraphStyles: [
        {
          id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 40, bold: true, font: 'IBM Plex Sans', color: PRIMARY_BLUE },
          paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 0 },
        },
        {
          id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
          run: { size: 28, bold: true, font: 'IBM Plex Sans', color: PRIMARY_BLUE },
          paragraph: { spacing: { before: 300, after: 80 }, outlineLevel: 1 },
        },
      ],
    },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 },
        },
      },
      children,
    }],
  });

  return Packer.toBuffer(doc);
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  // GET /api/save-article?list=1  — return saved article list
  if (req.method === 'GET') {
    try {
      const keys = await kvList('article:');
      const articles = [];
      for (const key of keys.slice(0, 50)) {
        try {
          const val = await kvGet(key);
          if (val) articles.push(JSON.parse(val));
        } catch (_) {}
      }
      articles.sort((a, b) => b.savedAt - a.savedAt);
      res.status(200).json({ articles });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  // POST /api/save-article  — save article + optionally return docx
  if (req.method === 'POST') {
    try {
      const { title, articleText, returnDocx } = req.body || {};
      if (!title || !articleText) {
        res.status(400).json({ error: 'title and articleText are required' }); return;
      }

      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60);
      const savedAt = Date.now();
      const key = `article:${savedAt}-${slug}`;
      const record = { key, title, slug, savedAt, length: articleText.length, preview: articleText.slice(0, 200) };

      // Save metadata to KV
      await kvSet(key + ':meta', JSON.stringify(record));
      // Save full text to KV
      await kvSet(key + ':text', articleText);

      if (returnDocx) {
        // Generate and stream docx
        const buffer = await buildDocx(title, articleText);
        const filename = `GGI_${slug}_${new Date().toISOString().slice(0, 10)}.docx`;
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Content-Length', buffer.length);
        res.status(200).end(buffer);
      } else {
        res.status(200).json({ saved: true, key, title, savedAt });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
    return;
  }

  res.status(405).end('Method not allowed');
};
