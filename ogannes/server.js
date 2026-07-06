import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { hash as hashArgon2, verify as verifyArgon2 } from '@node-rs/argon2';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');
const courseContentDir = path.join(dataDir, 'course-content');
const dbPath = path.join(dataDir, 'study-db.json');
const port = Number(process.env.PORT || 4173);

loadLocalEnv();

let adminUsername = process.env.ADMIN_USERNAME || 'ogannes';
let adminPassword = process.env.ADMIN_PASSWORD || '';
let adminPasswordHash = process.env.ADMIN_PASSWORD_HASH || '';
const botToken = process.env.TELEGRAM_BOT_TOKEN || '';
const botLink = process.env.PUBLIC_BOT_LINK || 'https://t.me/OgannesStudy_bot';
const siteAccessPassword = 'ius';
const siteAccessCookie = 'study_access_sid';
const sessions = new Map();
const loginAttempts = new Map();
const adminHashOptions = {
  memoryCost: Number(process.env.ARGON2_MEMORY_COST || 4096),
  timeCost: Number(process.env.ARGON2_TIME_COST || 2),
  parallelism: Number(process.env.ARGON2_PARALLELISM || 1),
  outputLen: 32
};

const defaultCourse = {
  id: 'iogp',
  title: 'ИОГП',
  subtitle: 'История отечественного государства и права',
  contentPath: 'public/course.html',
  createdAt: 0
};

const initialDb = {
  courses: [defaultCourse],
  assignments: [],
  students: [],
  submissions: [],
  topicNotes: {},
  accessIps: [],
  accessTokens: [],
  updatedAt: Date.now()
};

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function loadLocalEnv() {
  const envPath = path.join(__dirname, '.env');
  if (!existsSync(envPath)) return;

  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const equalIndex = trimmed.indexOf('=');
    if (equalIndex === -1) continue;
    const key = trimmed.slice(0, equalIndex).trim();
    let value = trimmed.slice(equalIndex + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

function adminConfigured() {
  return Boolean(adminPassword || adminPasswordHash);
}

function quoteEnvValue(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function upsertEnv(values) {
  const envPath = path.join(__dirname, '.env');
  const existing = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : [];
  const keys = new Set(Object.keys(values));
  const nextLines = existing
    .filter((line) => !keys.has(line.split('=')[0]?.trim()))
    .filter((line, index, lines) => line || index < lines.length - 1);

  for (const [key, value] of Object.entries(values)) {
    if (value !== '') nextLines.push(`${key}=${quoteEnvValue(value)}`);
  }
  writeFileSync(envPath, `${nextLines.join('\n')}\n`, 'utf8');
}

function normalizeDb(raw) {
  const db = { ...initialDb, ...(raw && typeof raw === 'object' ? raw : {}) };
  db.courses = Array.isArray(db.courses) && db.courses.length ? db.courses : [defaultCourse];
  if (!db.courses.some((course) => course.id === defaultCourse.id)) db.courses.unshift(defaultCourse);
  db.assignments = Array.isArray(db.assignments) ? db.assignments : [];
  db.students = Array.isArray(db.students) ? db.students : [];
  db.submissions = Array.isArray(db.submissions) ? db.submissions : [];
  db.topicNotes = db.topicNotes && typeof db.topicNotes === 'object' ? db.topicNotes : {};
  db.accessIps = Array.isArray(db.accessIps) ? db.accessIps : [];
  db.accessTokens = Array.isArray(db.accessTokens) ? db.accessTokens : [];

  for (const assignment of db.assignments) {
    if (!assignment.courseId) assignment.courseId = defaultCourse.id;
  }

  if (Object.keys(db.topicNotes).some((key) => typeof db.topicNotes[key] === 'string')) {
    db.topicNotes = { [defaultCourse.id]: db.topicNotes };
  }

  for (const course of db.courses) {
    if (!course.contentPath) course.contentPath = `data/course-content/${course.id}.html`;
  }

  return db;
}

function loadDb() {
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(courseContentDir, { recursive: true });
  if (!existsSync(dbPath)) {
    writeFileSync(dbPath, JSON.stringify(initialDb, null, 2), 'utf8');
  }
  try {
    return normalizeDb(JSON.parse(readFileSync(dbPath, 'utf8')));
  } catch {
    return normalizeDb(initialDb);
  }
}

function saveDb(db) {
  db.updatedAt = Date.now();
  writeFileSync(dbPath, JSON.stringify(normalizeDb(db), null, 2), 'utf8');
}

function cleanString(value, max = 4000) {
  return String(value || '').replace(/\0/g, '').trim().slice(0, max);
}

function slugify(value) {
  const ascii = cleanString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '');
  return ascii || `course-${Date.now().toString(36)}`;
}

function createId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function createBotCode() {
  return randomBytes(4).toString('hex').toUpperCase();
}

function normalizeBotCode(value) {
  return String(value || '').toUpperCase().replace(/[OО]/g, '0').replace(/[^A-F0-9]/g, '').slice(0, 12);
}

function sendText(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(body);
}

function sendJson(res, status, payload, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-Content-Type-Options': 'nosniff',
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function parseCookies(req) {
  return Object.fromEntries(
    String(req.headers.cookie || '')
      .split(';')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf('=');
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      })
  );
}

function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

async function readJson(req, maxBytes = 1024 * 1024) {
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (Buffer.byteLength(body) > maxBytes) throw new Error('payload-too-large');
  }
  return body ? JSON.parse(body) : {};
}

function publicCourses(db) {
  return db.courses.map(({ id, title, subtitle, createdAt }) => ({ id, title, subtitle, createdAt }));
}

function getCourse(db, courseId = defaultCourse.id) {
  return db.courses.find((course) => course.id === courseId) || db.courses[0] || defaultCourse;
}

function openAssignments(db, courseId = defaultCourse.id) {
  const now = Date.now();
  return db.assignments
    .filter((item) => item.courseId === courseId)
    .filter((item) => item.status !== 'closed' && new Date(item.deadline).getTime() > now)
    .sort((a, b) => new Date(a.deadline).getTime() - new Date(b.deadline).getTime());
}

function publicState(studentId = '', courseId = defaultCourse.id) {
  const db = loadDb();
  const course = getCourse(db, courseId);
  return {
    courses: publicCourses(db),
    course,
    assignments: openAssignments(db, course.id),
    submissions: studentId ? db.submissions.filter((item) => item.studentId === studentId) : [],
    student: studentId ? db.students.find((item) => item.id === studentId) || null : null,
    topicNotes: db.topicNotes[course.id] || {},
    bot: { enabled: Boolean(botToken), link: botLink },
    adminNeedsSetup: !adminConfigured()
  };
}

async function verifyAdminLogin(username, password) {
  if (username !== adminUsername) return false;
  if (!adminPassword && !adminPasswordHash) return false;
  if (adminPasswordHash) return verifyArgon2(adminPasswordHash, password);
  const left = Buffer.from(password);
  const right = Buffer.from(adminPassword);
  return left.length === right.length && timingSafeEqual(left, right);
}

function getClientKey(req) {
  return req.socket.remoteAddress || 'local';
}

function getClientIp(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const raw = forwarded || req.socket.remoteAddress || 'local';
  return raw.replace(/^::ffff:/, '');
}

function getAccessToken(req) {
  return parseCookies(req)[siteAccessCookie] || cleanString(req.headers['x-access-token'], 200);
}

function hasSiteAccess(req) {
  const db = loadDb();
  const ip = getClientIp(req);
  const token = getAccessToken(req);
  const now = Date.now();
  const tokenCount = db.accessTokens.length;
  db.accessTokens = db.accessTokens.filter((item) => !item.expiresAt || item.expiresAt > now);
  if (tokenCount !== db.accessTokens.length) saveDb(db);
  return {
    ok: db.accessIps.some((item) => item.ip === ip) || (token && db.accessTokens.some((item) => item.token === token)),
    ip,
    token
  };
}

function setSiteAccess(req) {
  const db = loadDb();
  const ip = getClientIp(req);
  const token = randomBytes(32).toString('hex');
  const now = Date.now();
  const ipRecord = db.accessIps.find((item) => item.ip === ip);
  if (ipRecord) ipRecord.lastSeenAt = now;
  else db.accessIps.push({ ip, createdAt: now, lastSeenAt: now });
  db.accessTokens.push({ token, ip, createdAt: now, expiresAt: now + 90 * 24 * 60 * 60 * 1000 });
  db.accessTokens = db.accessTokens.slice(-80);
  saveDb(db);
  return { ip, token };
}

function requireSiteAccess(req, res) {
  const access = hasSiteAccess(req);
  if (access.ok) return access;
  sendJson(res, 401, { error: 'site-locked' });
  return null;
}

function isLoginLimited(req) {
  const key = getClientKey(req);
  const item = loginAttempts.get(key) || { count: 0, until: 0 };
  if (item.until > Date.now()) return true;
  if (item.until && item.until <= Date.now()) loginAttempts.delete(key);
  return false;
}

function noteLoginFailure(req) {
  const key = getClientKey(req);
  const item = loginAttempts.get(key) || { count: 0, until: 0 };
  const count = item.count + 1;
  loginAttempts.set(key, {
    count,
    until: count >= 6 ? Date.now() + 5 * 60 * 1000 : 0
  });
}

function requireAdmin(req, res) {
  const sid = parseCookies(req).study_admin_sid;
  const session = sid ? sessions.get(sid) : null;
  if (!session || session.expiresAt < Date.now()) {
    if (sid) sessions.delete(sid);
    sendJson(res, 401, { error: 'login-required' });
    return null;
  }
  session.expiresAt = Date.now() + 2 * 60 * 60 * 1000;
  return session;
}

function adminDashboard() {
  const db = loadDb();
  return {
    courses: db.courses.sort((a, b) => a.createdAt - b.createdAt),
    assignments: db.assignments.sort((a, b) => b.createdAt - a.createdAt),
    students: db.students.sort((a, b) => b.createdAt - a.createdAt),
    submissions: db.submissions.sort((a, b) => b.createdAt - a.createdAt),
    topicNotes: db.topicNotes,
    bot: { enabled: Boolean(botToken), link: botLink }
  };
}

function sanitizeImportedHtml(html) {
  return String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<(iframe|form|object|embed|base|meta)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(iframe|form|object|embed|base|meta)\b[^>]*\/?>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');
}

function htmlShell(title, body) {
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(title)}</title>
<style>
body{margin:0;background:#fffaf1;color:#171b18;font:18px/1.75 Georgia,"Times New Roman",serif}
main{max-width:880px;margin:0 auto;padding:42px 22px 90px}
h1,h2,h3{line-height:1.16;color:#17201e}
h1{font-size:44px} h2{font-size:32px;margin-top:42px} h3{font-size:24px;margin-top:30px}
p,li{max-width:76ch} table{border-collapse:collapse;width:100%;font-size:15px} td,th{border:1px solid #d9c8aa;padding:8px}
img{max-width:100%;height:auto}
</style>
</head>
<body><main>${body}</main></body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function normalizeImportedHtml(title, html) {
  const sanitized = sanitizeImportedHtml(html);
  const body = sanitized.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] || sanitized;
  return htmlShell(title, body);
}

function decodeHtml(value) {
  return String(value || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function textFromHtml(html, max = 6000) {
  return decodeHtml(
    String(html || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  ).slice(0, max);
}

function extractClassText(html, className, max = 2000) {
  const pattern = new RegExp(`<[^>]+class=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, 'i');
  return textFromHtml(html.match(pattern)?.[1] || '', max);
}

function editorId(prefix, text = '') {
  return slugify(text).slice(0, 54) || createId(prefix);
}

function defaultEditorCourse(course) {
  return {
    title: course.title || 'Новый курс',
    subtitle: course.subtitle || '',
    author: 'Туманян Оганнес',
    year: '2026',
    sections: [
      {
        id: 'topic-start',
        title: course.title || 'Первая тема',
        period: '',
        blocks: [
          { id: createId('block'), type: 'text', title: '', text: 'Напиши краткое объяснение темы простыми словами.' },
          {
            id: createId('block'),
            type: 'cards',
            title: 'Главное',
            cards: [
              { title: 'Первый факт', text: 'Что важно запомнить.' },
              { title: 'Пример', text: 'Короткий пример для ученика.' }
            ]
          }
        ]
      }
    ],
    updatedAt: Date.now()
  };
}

function parseCourseHtmlToEditor(course, html) {
  const editor = {
    title: course.title || 'Курс',
    subtitle: course.subtitle || extractClassText(html, 'site-header-title', 160) || '',
    author: 'Туманян Оганнес',
    year: '2026',
    sections: [],
    updatedAt: Date.now()
  };
  const sectionPattern = /<section\b[^>]*class=["'][^"']*\bsection\b[^"']*["'][^>]*id=["']([^"']+)["'][^>]*>([\s\S]*?)<\/section>/gi;
  let match;
  while ((match = sectionPattern.exec(html))) {
    const [, id, sectionHtml] = match;
    const title = extractClassText(sectionHtml, 'section-title', 180) || `Тема ${editor.sections.length + 1}`;
    const period = extractClassText(sectionHtml, 'section-period', 120);
    const blocks = [];

    const cards = [];
    const cardPattern = /<div\b[^>]*class=["'][^"']*\bcard\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi;
    let cardMatch;
    while ((cardMatch = cardPattern.exec(sectionHtml))) {
      const cardHtml = cardMatch[1];
      const cardTitle = extractClassText(cardHtml, 'card-title', 120) || textFromHtml(cardHtml, 80);
      const cardText = textFromHtml(cardHtml.replace(/<[^>]+class=["'][^"']*\bcard-title\b[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/i, ''), 700);
      if (cardTitle || cardText) cards.push({ title: cardTitle, text: cardText });
    }
    if (cards.length) blocks.push({ id: createId('block'), type: 'cards', title: 'Главное', cards: cards.slice(0, 12) });

    const withoutCards = sectionHtml.replace(/<div\b[^>]*class=["'][^"']*\bcards\b[^"']*["'][^>]*>[\s\S]*?<\/div>\s*<\/div>/gi, '');
    const paragraphs = [];
    const paragraphPattern = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
    let paragraphMatch;
    while ((paragraphMatch = paragraphPattern.exec(withoutCards))) {
      const text = textFromHtml(paragraphMatch[1], 1200);
      if (text && !paragraphs.includes(text)) paragraphs.push(text);
      if (paragraphs.length >= 8) break;
    }
    if (paragraphs.length) blocks.unshift({ id: createId('block'), type: 'text', title: '', text: paragraphs.join('\n\n') });

    if (!blocks.length) blocks.push({ id: createId('block'), type: 'text', title: '', text: textFromHtml(sectionHtml, 1800) });
    editor.sections.push({ id: cleanString(id, 80) || editorId('topic', title), title, period, blocks });
    if (editor.sections.length >= 60) break;
  }
  return editor.sections.length ? editor : defaultEditorCourse(course);
}

function getEditorCourse(db, courseId) {
  const course = getCourse(db, courseId);
  if (course.editor?.sections?.length) return { courseId: course.id, ...course.editor };
  const filePath = resolveCourseContentPath(course);
  if (filePath && existsSync(filePath)) {
    return { courseId: course.id, ...parseCourseHtmlToEditor(course, readFileSync(filePath, 'utf8')) };
  }
  return { courseId: course.id, ...defaultEditorCourse(course) };
}

function normalizeEditorBlock(rawBlock) {
  const type = ['text', 'cards', 'list', 'quote'].includes(rawBlock?.type) ? rawBlock.type : 'text';
  const block = {
    id: cleanString(rawBlock?.id, 80) || createId('block'),
    type,
    title: cleanString(rawBlock?.title, 160),
    text: cleanString(rawBlock?.text, 8000)
  };
  if (type === 'list') {
    block.items = Array.isArray(rawBlock.items)
      ? rawBlock.items.map((item) => cleanString(item, 500)).filter(Boolean).slice(0, 80)
      : [];
  }
  if (type === 'cards') {
    block.cards = Array.isArray(rawBlock.cards)
      ? rawBlock.cards
        .map((card) => ({ title: cleanString(card?.title, 120), text: cleanString(card?.text, 900) }))
        .filter((card) => card.title || card.text)
        .slice(0, 24)
      : [];
  }
  return block;
}

function normalizeEditorCourse(payload, course) {
  const sections = Array.isArray(payload.sections) ? payload.sections : [];
  return {
    title: cleanString(payload.title || course.title, 140) || course.title,
    subtitle: cleanString(payload.subtitle || course.subtitle, 260),
    author: cleanString(payload.author || 'Туманян Оганнес', 120),
    year: cleanString(payload.year || '2026', 12),
    sections: sections
      .map((section, index) => {
        const title = cleanString(section?.title || `Тема ${index + 1}`, 180);
        return {
          id: cleanString(section?.id, 80) || editorId('topic', title),
          title,
          period: cleanString(section?.period, 120),
          blocks: (Array.isArray(section?.blocks) ? section.blocks : []).map(normalizeEditorBlock).slice(0, 80)
        };
      })
      .filter((section) => section.title)
      .slice(0, 80),
    updatedAt: Date.now()
  };
}

function renderEditorBlock(block) {
  if (block.type === 'cards') {
    const cards = (block.cards || []).map((card) => `<article class="card"><h3>${escapeHtml(card.title || 'Факт')}</h3><p>${escapeHtml(card.text || '')}</p></article>`).join('');
    return `<div class="cards">${cards}</div>`;
  }
  if (block.type === 'list') {
    const items = (block.items || []).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
    return `${block.title ? `<h3 class="sub-title">${escapeHtml(block.title)}</h3>` : ''}<ul class="styled">${items}</ul>`;
  }
  if (block.type === 'quote') {
    return `<blockquote class="source-quote">${block.title ? `<strong>${escapeHtml(block.title)}</strong>` : ''}<p>${escapeHtml(block.text)}</p></blockquote>`;
  }
  const paragraphs = String(block.text || '')
    .split(/\n{2,}/)
    .map((line) => cleanString(line, 2000))
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('');
  return `${block.title ? `<h3 class="sub-title">${escapeHtml(block.title)}</h3>` : ''}${paragraphs}`;
}

function renderEditorCourseHtml(editor) {
  const sections = editor.sections.map((section, index) => `
<section class="section" id="${escapeHtml(section.id)}">
  <div class="section-head">
    <div class="drop-cap">${escapeHtml(section.title.slice(0, 1))}</div>
    <div class="section-meta">
      <div class="section-title">${escapeHtml(section.title)}</div>
      ${section.period ? `<div class="section-period">${escapeHtml(section.period)}</div>` : ''}
    </div>
  </div>
  ${section.blocks.map(renderEditorBlock).join('\n')}
</section>`).join('\n');
  const nav = editor.sections.map((section) => `<a href="#${escapeHtml(section.id)}">${escapeHtml(section.title)}</a>`).join('');
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(editor.title)}</title>
<style>
:root{--ink:#181512;--muted:#6f665b;--paper:#fffdf8;--line:#d8c7aa;--accent:#9b4038;--green:#17201e;--gold:#b3833f}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:18px/1.72 Georgia,"Times New Roman",serif}
.site-header{background:var(--green);color:#fff;display:flex;justify-content:space-between;gap:16px;padding:12px 38px;border-bottom:3px solid var(--gold)}
.site-header-title{color:var(--gold);font:700 12px/1 system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase}.site-header-sub{font:700 11px/1 system-ui,sans-serif;letter-spacing:.08em;opacity:.55}
.layout{display:block}.sidebar{display:none}.main{max-width:1380px;margin:0 auto;padding:24px clamp(18px,3vw,42px) 90px}
.hero{display:none}.section{margin-bottom:46px;scroll-margin-top:18px}.section-head{align-items:flex-start;border-bottom:2px solid var(--line);display:flex;gap:18px;margin-bottom:24px;padding-bottom:16px}
.drop-cap{color:var(--accent);font-size:68px;line-height:.9}.section-title{font-size:clamp(28px,3vw,42px);font-weight:700;line-height:1.1}.section-period{color:var(--muted);font:13px/1.4 system-ui,sans-serif;margin-top:8px}
.cards{display:grid;gap:14px;grid-template-columns:repeat(4,minmax(0,1fr));margin:24px 0}.card{border:1px solid var(--line);border-top:3px solid var(--accent);border-radius:8px;padding:18px 20px}.card h3{font-size:19px;margin:0 0 10px}.card p{font-size:16px;margin:0}
p{max-width:112ch}.sub-title{border-left:4px solid var(--accent);font-size:25px;margin-top:30px;padding-left:14px}.styled{padding-left:24px}.source-quote{background:#17201e;border-radius:8px;color:#fff;margin:24px 0;padding:20px 24px}.source-quote strong{color:var(--gold);display:block;margin-bottom:8px}.source-quote p{margin:0;opacity:.82}
footer{background:var(--green);color:rgba(255,255,255,.52);font:700 12px/1 system-ui,sans-serif;letter-spacing:.08em;padding:24px 38px;text-align:center}
@media(max-width:1100px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}@media(max-width:720px){body{font-size:17px}.site-header{padding:10px 14px}.main{padding:16px 14px 70px}.section-head{gap:10px}.drop-cap{font-size:50px}.cards{grid-template-columns:1fr}.section-title{font-size:30px}}
</style>
</head>
<body>
<header class="site-header"><div><div class="site-header-title">${escapeHtml(editor.title)}</div><div class="site-header-sub">© ${escapeHtml(editor.author)} · ${escapeHtml(editor.year)}</div></div><nav>${nav}</nav></header>
<div class="layout"><main class="main">${sections}</main></div>
<footer>© ${escapeHtml(editor.author)} · ${escapeHtml(editor.year)}</footer>
</body>
</html>`;
}

function resolveCourseContentPath(course) {
  const relativePath = course.contentPath || defaultCourse.contentPath;
  const resolved = path.resolve(__dirname, relativePath);
  const allowedData = resolved.startsWith(courseContentDir + path.sep);
  const allowedPublic = resolved.startsWith(publicDir + path.sep);
  if (!allowedData && !allowedPublic) return null;
  return resolved;
}

async function telegramApi(method, payload) {
  if (!botToken) return null;
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`telegram-${method}-${response.status}`);
  return response.json();
}

async function sendTelegram(chatId, text) {
  if (!chatId || !botToken) return false;
  await telegramApi('sendMessage', { chat_id: chatId, text, disable_web_page_preview: true });
  return true;
}

function assignmentMessage(assignment) {
  const deadline = new Date(assignment.deadline).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
  return `Новая домашка: ${assignment.title}\n\n${assignment.body}\n\nДедлайн: ${deadline}\nСдать: открой сайт, вкладка ДЗ.`;
}

async function notifyStudentsAboutAssignment(assignment) {
  const db = loadDb();
  const boundStudents = db.students.filter((student) => student.chatId);
  await Promise.allSettled(boundStudents.map((student) => sendTelegram(student.chatId, assignmentMessage(assignment))));
}

async function notifyFeedback(submission) {
  const db = loadDb();
  const student = db.students.find((item) => item.id === submission.studentId);
  const assignment = db.assignments.find((item) => item.id === submission.assignmentId);
  if (!student?.chatId || !assignment) return;
  await sendTelegram(student.chatId, `Фидбек по ДЗ: ${assignment.title}\n\n${submission.feedback || 'Пока без текста.'}`);
}

let telegramOffset = 0;
let telegramPolling = false;
async function pollTelegram() {
  if (!botToken) return;
  try {
    const result = await telegramApi('getUpdates', {
      offset: telegramOffset,
      timeout: 20,
      allowed_updates: ['message']
    });
    for (const update of result?.result || []) {
      telegramOffset = update.update_id + 1;
      await handleTelegramMessage(update.message);
    }
  } catch (error) {
    console.warn(`Telegram polling paused: ${error.message}`);
  }
}

async function handleTelegramMessage(message) {
  if (!message?.chat?.id) return;
  const text = cleanString(message.text, 120);
  const db = loadDb();
  const code = normalizeBotCode(text.startsWith('/start') ? text.split(/\s+/)[1] : text);
  if (code && /^[A-Z0-9]{6,12}$/i.test(code)) {
    const student = db.students.find((item) => normalizeBotCode(item.botCode) === code);
    if (student) {
      student.chatId = String(message.chat.id);
      student.telegram = message.from?.username ? `@${message.from.username}` : student.telegram;
      saveDb(db);
      await sendTelegram(student.chatId, 'Готово, Telegram привязан. Теперь сюда будут приходить задания и фидбек.');
      return;
    }
    await sendTelegram(String(message.chat.id), 'Код не найден. Открой сайт заново, укажи Telegram и пришли новый код.');
    return;
  }
  if (text === '/tasks') {
    const tasks = openAssignments(db, defaultCourse.id);
    const body = tasks.length ? tasks.map((item, index) => `${index + 1}. ${item.title}`).join('\n') : 'Открытых заданий сейчас нет.';
    await sendTelegram(String(message.chat.id), body);
    return;
  }
  await sendTelegram(String(message.chat.id), `Пришли код из профиля на сайте. Бот: ${botLink}`);
}

async function handleApi(req, res, url) {
  if (!isSameOrigin(req)) {
    sendJson(res, 403, { error: 'bad-origin' });
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/access/status') {
    const access = hasSiteAccess(req);
    sendJson(res, 200, { allowed: Boolean(access.ok), ip: access.ip });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/access/login') {
    if (isLoginLimited(req)) {
      sendJson(res, 429, { error: 'too-many-attempts' });
      return true;
    }
    const body = await readJson(req, 16 * 1024);
    const password = String(body.password || '');
    if (password !== siteAccessPassword) {
      noteLoginFailure(req);
      sendJson(res, 401, { error: 'bad-access-password' });
      return true;
    }
    const access = setSiteAccess(req);
    sendJson(res, 200, { ok: true, ip: access.ip }, {
      'Set-Cookie': `${siteAccessCookie}=${access.token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${90 * 24 * 60 * 60}`
    });
    return true;
  }

  if (!requireSiteAccess(req, res)) return true;

  if (req.method === 'GET' && url.pathname === '/api/state') {
    sendJson(res, 200, publicState(url.searchParams.get('studentId') || '', url.searchParams.get('courseId') || defaultCourse.id));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/students') {
    const body = await readJson(req);
    const name = cleanString(body.name, 80);
    const telegram = cleanString(body.telegram, 80);
    const courseId = cleanString(body.courseId || defaultCourse.id, 80);
    if (!name) {
      sendJson(res, 400, { error: 'name-required' });
      return true;
    }
    const db = loadDb();
    let student = db.students.find((item) => telegram && item.telegram.toLowerCase() === telegram.toLowerCase());
    if (!student) {
      student = { id: createId('student'), name, telegram, botCode: createBotCode(), chatId: '', createdAt: Date.now() };
      db.students.push(student);
    } else {
      student.name = name;
      student.telegram = telegram;
    }
    saveDb(db);
    sendJson(res, 200, { student, state: publicState(student.id, courseId) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/submissions') {
    const body = await readJson(req);
    const assignmentId = cleanString(body.assignmentId, 80);
    const studentId = cleanString(body.studentId, 80);
    const courseId = cleanString(body.courseId || defaultCourse.id, 80);
    const answer = cleanString(body.answer, 12000);
    const db = loadDb();
    const assignment = openAssignments(db, courseId).find((item) => item.id === assignmentId);
    const student = db.students.find((item) => item.id === studentId);
    if (!assignment || !student || answer.length < 10) {
      sendJson(res, 400, { error: 'bad-submission' });
      return true;
    }
    const existing = db.submissions.find((item) => item.assignmentId === assignmentId && item.studentId === studentId);
    if (existing) {
      existing.answer = answer;
      existing.updatedAt = Date.now();
    } else {
      db.submissions.push({
        id: createId('submission'),
        assignmentId,
        studentId,
        answer,
        feedback: '',
        feedbackAt: 0,
        createdAt: Date.now()
      });
    }
    saveDb(db);
    sendJson(res, 200, publicState(studentId, courseId));
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/login') {
    if (isLoginLimited(req)) {
      sendJson(res, 429, { error: 'too-many-attempts' });
      return true;
    }
    const body = await readJson(req, 32 * 1024);
    const username = cleanString(body.username, 80);
    const password = String(body.password || '');
    const ok = await verifyAdminLogin(username, password);
    if (!ok) {
      noteLoginFailure(req);
      sendJson(res, 401, { error: 'bad-login' });
      return true;
    }
    const sid = randomBytes(32).toString('hex');
    sessions.set(sid, { username, createdAt: Date.now(), expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': `study_admin_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200` });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/setup') {
    if (adminConfigured()) {
      sendJson(res, 409, { error: 'already-configured' });
      return true;
    }
    const body = await readJson(req, 32 * 1024);
    const username = cleanString(body.username || 'ogannes', 80);
    const password = String(body.password || '');
    if (!username || password.length < 8) {
      sendJson(res, 400, { error: 'weak-setup' });
      return true;
    }
    adminUsername = username;
    adminPassword = '';
    adminPasswordHash = await hashArgon2(password, adminHashOptions);
    upsertEnv({ ADMIN_USERNAME: adminUsername, ADMIN_PASSWORD_HASH: adminPasswordHash, PUBLIC_BOT_LINK: botLink });
    const sid = randomBytes(32).toString('hex');
    sessions.set(sid, { username, createdAt: Date.now(), expiresAt: Date.now() + 2 * 60 * 60 * 1000 });
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': `study_admin_sid=${sid}; HttpOnly; SameSite=Lax; Path=/; Max-Age=7200` });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/logout') {
    const sid = parseCookies(req).study_admin_sid;
    if (sid) sessions.delete(sid);
    sendJson(res, 200, { ok: true }, { 'Set-Cookie': 'study_admin_sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
    return true;
  }

  if (url.pathname.startsWith('/api/admin')) {
    if (!requireAdmin(req, res)) return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/dashboard') {
    sendJson(res, 200, adminDashboard());
    return true;
  }

  if (req.method === 'GET' && url.pathname === '/api/admin/course-editor') {
    const db = loadDb();
    const courseId = cleanString(url.searchParams.get('courseId') || defaultCourse.id, 120);
    const course = getCourse(db, courseId);
    if (!course || course.id !== courseId) {
      sendJson(res, 404, { error: 'course-not-found' });
      return true;
    }
    sendJson(res, 200, { editor: getEditorCourse(db, courseId) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/course-editor') {
    const body = await readJson(req, 2 * 1024 * 1024);
    const db = loadDb();
    const courseId = cleanString(body.courseId || defaultCourse.id, 120);
    const course = getCourse(db, courseId);
    if (!course || course.id !== courseId) {
      sendJson(res, 404, { error: 'course-not-found' });
      return true;
    }
    const editor = normalizeEditorCourse(body.editor || {}, course);
    if (!editor.title || !editor.sections.length || editor.sections.some((section) => !section.blocks.length)) {
      sendJson(res, 400, { error: 'bad-editor' });
      return true;
    }
    course.title = editor.title;
    course.subtitle = editor.subtitle;
    course.editor = editor;
    course.contentPath = `data/course-content/${course.id}.html`;
    course.updatedAt = Date.now();
    writeFileSync(path.join(courseContentDir, `${course.id}.html`), renderEditorCourseHtml(editor), 'utf8');
    saveDb(db);
    sendJson(res, 200, { ok: true, editor: { courseId: course.id, ...editor }, dashboard: adminDashboard(), state: publicState('', course.id) });
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/courses') {
    const body = await readJson(req);
    const title = cleanString(body.title, 120);
    const subtitle = cleanString(body.subtitle, 240);
    if (!title) {
      sendJson(res, 400, { error: 'bad-course' });
      return true;
    }
    const db = loadDb();
    const baseId = slugify(title);
    let id = baseId;
    let index = 2;
    while (db.courses.some((course) => course.id === id)) id = `${baseId}-${index++}`;
    const course = {
      id,
      title,
      subtitle,
      contentPath: `data/course-content/${id}.html`,
      editor: defaultEditorCourse({ title, subtitle }),
      createdAt: Date.now()
    };
    writeFileSync(path.join(courseContentDir, `${id}.html`), renderEditorCourseHtml(course.editor), 'utf8');
    db.courses.push(course);
    saveDb(db);
    sendJson(res, 200, adminDashboard());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/import-html') {
    const body = await readJson(req, 5 * 1024 * 1024);
    const courseId = cleanString(body.courseId, 120);
    const title = cleanString(body.title, 160);
    const html = String(body.html || '');
    const db = loadDb();
    const course = getCourse(db, courseId);
    if (!course || course.id !== courseId || !html.trim()) {
      sendJson(res, 400, { error: 'bad-import' });
      return true;
    }
    const filename = `${course.id}.html`;
    const relativePath = `data/course-content/${filename}`;
    const normalizedHtml = normalizeImportedHtml(title || course.title, html);
    writeFileSync(path.join(courseContentDir, filename), normalizedHtml, 'utf8');
    course.contentPath = relativePath;
    if (title) course.title = title;
    course.editor = parseCourseHtmlToEditor(course, normalizedHtml);
    saveDb(db);
    sendJson(res, 200, adminDashboard());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/assignments') {
    const body = await readJson(req);
    const courseId = cleanString(body.courseId || defaultCourse.id, 120);
    const title = cleanString(body.title, 160);
    const bodyText = cleanString(body.body, 6000);
    const topicId = cleanString(body.topicId, 120);
    const topicTitle = cleanString(body.topicTitle, 180);
    const deadline = new Date(body.deadline);
    if (!title || !bodyText || Number.isNaN(deadline.getTime())) {
      sendJson(res, 400, { error: 'bad-assignment' });
      return true;
    }
    const db = loadDb();
    const assignment = {
      id: createId('task'),
      courseId,
      title,
      body: bodyText,
      topicId,
      topicTitle,
      deadline: deadline.toISOString(),
      status: 'open',
      createdAt: Date.now()
    };
    db.assignments.push(assignment);
    saveDb(db);
    notifyStudentsAboutAssignment(assignment).catch((error) => console.warn(`Telegram notify failed: ${error.message}`));
    sendJson(res, 200, adminDashboard());
    return true;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/admin/assignments/')) {
    const id = cleanString(url.pathname.split('/').at(-1), 120);
    const body = await readJson(req);
    const db = loadDb();
    const assignment = db.assignments.find((item) => item.id === id);
    if (!assignment) {
      sendJson(res, 404, { error: 'not-found' });
      return true;
    }
    assignment.status = body.status === 'closed' ? 'closed' : 'open';
    saveDb(db);
    sendJson(res, 200, adminDashboard());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/feedback') {
    const body = await readJson(req);
    const submissionId = cleanString(body.submissionId, 120);
    const feedback = cleanString(body.feedback, 6000);
    const db = loadDb();
    const submission = db.submissions.find((item) => item.id === submissionId);
    if (!submission || !feedback) {
      sendJson(res, 400, { error: 'bad-feedback' });
      return true;
    }
    submission.feedback = feedback;
    submission.feedbackAt = Date.now();
    saveDb(db);
    notifyFeedback(submission).catch((error) => console.warn(`Telegram feedback failed: ${error.message}`));
    sendJson(res, 200, adminDashboard());
    return true;
  }

  if (req.method === 'POST' && url.pathname === '/api/admin/topic-note') {
    const body = await readJson(req);
    const courseId = cleanString(body.courseId || defaultCourse.id, 120);
    const topicId = cleanString(body.topicId, 120);
    const note = cleanString(body.note, 2500);
    const db = loadDb();
    if (!topicId) {
      sendJson(res, 400, { error: 'bad-topic' });
      return true;
    }
    db.topicNotes[courseId] = db.topicNotes[courseId] || {};
    if (note) db.topicNotes[courseId][topicId] = note;
    else delete db.topicNotes[courseId][topicId];
    saveDb(db);
    sendJson(res, 200, adminDashboard());
    return true;
  }

  sendJson(res, 404, { error: 'not-found' });
  return true;
}

function resolveStaticPath(urlPath) {
  const safePath = decodeURIComponent(urlPath.split('?')[0] || '/');
  const normalizedPath = safePath === '/' ? '/index.html' : safePath;
  const filePath = path.resolve(distDir, `.${normalizedPath}`);
  if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) return null;
  return filePath;
}

async function handleCourseContent(req, res, url) {
  if (!requireSiteAccess(req, res)) return true;
  const courseId = decodeURIComponent(url.pathname.replace('/course-content/', ''));
  const db = loadDb();
  const course = getCourse(db, courseId);
  const filePath = resolveCourseContentPath(course);
  if (!filePath || !existsSync(filePath)) {
    sendText(res, 404, 'Курс не найден');
    return true;
  }
  res.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-cache',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'; img-src 'self' data: https:; style-src 'unsafe-inline'; font-src data:",
    'X-Content-Type-Options': 'nosniff'
  });
  createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/course-content/')) {
      await handleCourseContent(req, res, url);
      return;
    }

    if (!existsSync(distDir)) {
      sendText(res, 503, 'Сначала собери проект: npm run build');
      return;
    }

    const requestedPath = resolveStaticPath(req.url || '/');
    if (!requestedPath) {
      sendText(res, 403, 'Forbidden');
      return;
    }

    let filePath = requestedPath;
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(distDir, 'index.html');

    const ext = path.extname(filePath).toLowerCase();
    const isHashedAsset = filePath.includes(`${path.sep}assets${path.sep}`);
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': isHashedAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'SAMEORIGIN',
      'X-Content-Type-Options': 'nosniff'
    });
    createReadStream(filePath).pipe(res);
  } catch (error) {
    const status = error.message === 'payload-too-large' ? 413 : 500;
    sendJson(res, status, { error: status === 413 ? 'payload-too-large' : 'server-error' });
  }
});

async function startTelegram() {
  if (!botToken) return;
  try {
    await telegramApi('deleteWebhook', { drop_pending_updates: false });
  } catch (error) {
    console.warn(`Telegram webhook cleanup failed: ${error.message}`);
  }
  const tick = async () => {
    try {
      if (!telegramPolling) {
        telegramPolling = true;
        await pollTelegram();
      }
    } catch (error) {
      console.warn(`Telegram polling failed: ${error.message}`);
    } finally {
      telegramPolling = false;
      setTimeout(tick, 1200);
    }
  };
  tick();
}

server.listen(port, '0.0.0.0', () => {
  const addresses = Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === 'IPv4' && !item.internal)
    .map((item) => `http://${item.address}:${port}`);

  console.log(`Локально: http://localhost:${port}`);
  addresses.forEach((address) => console.log(`Телефон в той же Wi-Fi сети: ${address}`));
  console.log(botToken ? 'Telegram bot: enabled' : 'Telegram bot: disabled, set TELEGRAM_BOT_TOKEN in .env');
  startTelegram();
});
