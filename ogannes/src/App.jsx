import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const ACTIVE_COURSE_KEY = 'ogannes-study-shell:v3:active-course';
const STUDENT_KEY = 'ogannes-study-shell:v3:student';
const SIDE_KEY = 'ogannes-study-shell:v3:side-open';
const ACCESS_CACHE_KEY = 'ogannes-study-shell:v3:access-ok';
const SOLUTION_KEY = 'ogannes-study-shell:v3:solution-drafts';

const STATUS_META = {
  new: { label: 'новая', weight: 0 },
  reading: { label: 'читаю', weight: 1 },
  understood: { label: 'понял', weight: 2 },
  exam: { label: 'готов', weight: 3 }
};

function progressKey(courseId) {
  return `ogannes-study-shell:v3:progress:${courseId || 'iogp'}`;
}

function defaultProgress() {
  return { statuses: {}, lastTopic: '', lastScroll: 0, sessions: 0, activeDays: [] };
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function cleanText(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function safeJson(value, fallback) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function loadProgress(courseId) {
  const saved = safeJson(localStorage.getItem(progressKey(courseId)), defaultProgress());
  return { ...defaultProgress(), ...saved, statuses: { ...(saved.statuses || {}) } };
}

function saveProgress(courseId, progress) {
  localStorage.setItem(progressKey(courseId), JSON.stringify(progress));
}

function loadStudent() {
  return safeJson(localStorage.getItem(STUDENT_KEY), null);
}

function saveStudent(student) {
  if (student) localStorage.setItem(STUDENT_KEY, JSON.stringify(student));
  else localStorage.removeItem(STUDENT_KEY);
}

function formatDeadline(value) {
  return new Date(value).toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function defaultDeadline() {
  const date = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  return date.toISOString().slice(0, 16);
}

async function api(path, options = {}) {
  const url = path.startsWith('/ogannes/') ? path : `/ogannes${path}`;
  const response = await fetch(url, {
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (payload.error === 'site-locked') {
      localStorage.removeItem(ACCESS_CACHE_KEY);
    }
    throw new Error(payload.error || 'request-failed');
  }
  return payload;
}

function loadSolutionDrafts() {
  return safeJson(localStorage.getItem(SOLUTION_KEY), {});
}

function saveSolutionDrafts(drafts) {
  localStorage.setItem(SOLUTION_KEY, JSON.stringify(drafts));
}

function createGeneratedTask(topic, course) {
  const title = topic?.title || course?.title || 'тема';
  return {
    title: `Сдача: ${title}`,
    body: `Объясни тему "${title}" простыми словами: 2 главные идеи, 1 пример, 1 вывод. Объем: 8-12 предложений.`
  };
}

function inspectHtml(html) {
  if (!html.trim()) return { headings: 0, scripts: 0, length: 0 };
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    headings: doc.querySelectorAll('h1,h2,h3,.section[id]').length,
    scripts: doc.querySelectorAll('script,iframe,form').length,
    length: html.length
  };
}

function makeDraftId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`;
}

function slugText(value) {
  return cleanText(value)
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '') || makeDraftId('topic');
}

function createEditorBlock(type = 'text') {
  const base = { id: makeDraftId('block'), type, title: '', text: '' };
  if (type === 'cards') {
    return { ...base, title: 'Главное', cards: [{ title: 'Факт', text: 'Что важно запомнить.' }] };
  }
  if (type === 'list') {
    return { ...base, title: 'Список', items: ['Первый пункт'] };
  }
  if (type === 'quote') {
    return { ...base, title: 'Источник', text: 'Короткая цитата или важная мысль.' };
  }
  return { ...base, text: 'Новый текст темы.' };
}

function createEditorSection(title = 'Новая тема') {
  return {
    id: slugText(title),
    title,
    period: '',
    blocks: [createEditorBlock('text')]
  };
}

function normalizeEditorDraft(editor, fallbackCourse) {
  if (editor?.sections?.length) return editor;
  return {
    courseId: fallbackCourse?.id || 'iogp',
    title: fallbackCourse?.title || 'Курс',
    subtitle: fallbackCourse?.subtitle || '',
    author: 'Туманян Оганнес',
    year: '2026',
    sections: [createEditorSection('Первая тема')]
  };
}

function blockLabel(type) {
  return { text: 'Текст', cards: 'Карточки', list: 'Список', quote: 'Цитата' }[type] || 'Блок';
}

function moveItem(items, index, direction) {
  const next = [...items];
  const target = index + direction;
  if (target < 0 || target >= next.length) return next;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export default function App() {
  const frameRef = useRef(null);
  const cleanupFrameRef = useRef(null);

  const [accessAllowed, setAccessAllowed] = useState(false);
  const [accessChecking, setAccessChecking] = useState(true);
  const [accessPassword, setAccessPassword] = useState('');
  const [accessError, setAccessError] = useState('');
  const [view, setView] = useState('catalog');
  const [activeCourseId, setActiveCourseId] = useState(localStorage.getItem(ACTIVE_COURSE_KEY) || 'iogp');
  const [sideOpen, setSideOpen] = useState(localStorage.getItem(SIDE_KEY) === 'true');
  const [state, setState] = useState({ courses: [], assignments: [], submissions: [], topicNotes: {}, bot: {} });
  const [student, setStudent] = useState(loadStudent);
  const [studentForm, setStudentForm] = useState({ name: '', telegram: '' });
  const [forceNewStudent, setForceNewStudent] = useState(false);
  const [solutionDrafts, setSolutionDrafts] = useState(loadSolutionDrafts);
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const [sections, setSections] = useState([]);
  const [currentTopicId, setCurrentTopicId] = useState('');
  const [progress, setProgress] = useState(loadProgress(activeCourseId));
  const [toast, setToast] = useState('');

  const [adminLoggedIn, setAdminLoggedIn] = useState(false);
  const [adminTab, setAdminTab] = useState('courses');
  const [adminLogin, setAdminLogin] = useState({ username: 'ogannes', password: '' });
  const [adminSetup, setAdminSetup] = useState({ username: 'ogannes', password: '', repeat: '' });
  const [adminError, setAdminError] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [courseDraft, setCourseDraft] = useState({ title: '', subtitle: '' });
  const [editorCourseId, setEditorCourseId] = useState(activeCourseId);
  const [courseEditor, setCourseEditor] = useState(null);
  const [selectedEditorSectionId, setSelectedEditorSectionId] = useState('');
  const [editorDirty, setEditorDirty] = useState(false);
  const [editorSaving, setEditorSaving] = useState(false);
  const [editorError, setEditorError] = useState('');
  const [editorPreviewOpen, setEditorPreviewOpen] = useState(false);
  const [importDraft, setImportDraft] = useState({ courseId: activeCourseId, title: '', html: '' });
  const [taskDraft, setTaskDraft] = useState({ courseId: activeCourseId, topicId: '', title: '', body: '', deadline: defaultDeadline() });
  const [taskCourseEditor, setTaskCourseEditor] = useState(null);
  const [taskError, setTaskError] = useState('');
  const [topicNoteDraft, setTopicNoteDraft] = useState({ courseId: activeCourseId, topicId: '', note: '' });
  const [feedbackDrafts, setFeedbackDrafts] = useState({});

  const activeCourse = useMemo(() => {
    return state.courses?.find((course) => course.id === activeCourseId) || state.course || state.courses?.[0] || null;
  }, [activeCourseId, state.course, state.courses]);

  const adminCourses = useMemo(() => {
    return dashboard?.courses?.length ? dashboard.courses : (state.courses || []);
  }, [dashboard?.courses, state.courses]);

  const taskCourse = useMemo(() => {
    return adminCourses.find((course) => course.id === taskDraft.courseId) || activeCourse;
  }, [activeCourse, adminCourses, taskDraft.courseId]);

  const taskTopics = useMemo(() => {
    if (taskCourseEditor?.courseId === taskDraft.courseId) return taskCourseEditor.sections || [];
    return taskDraft.courseId === activeCourseId ? sections : [];
  }, [activeCourseId, sections, taskCourseEditor, taskDraft.courseId]);

  const currentTopic = useMemo(() => {
    return sections.find((topic) => topic.id === (currentTopicId || progress.lastTopic)) || sections[0] || null;
  }, [sections, currentTopicId, progress.lastTopic]);

  const progressStats = useMemo(() => {
    const max = Math.max(sections.length * STATUS_META.exam.weight, 1);
    const score = sections.reduce((sum, topic) => sum + (STATUS_META[progress.statuses[topic.id] || 'new']?.weight || 0), 0);
    return { percent: Math.round((score / max) * 100) };
  }, [progress.statuses, sections]);

  const submissionsByTask = useMemo(() => {
    return Object.fromEntries((state.submissions || []).map((item) => [item.assignmentId, item]));
  }, [state.submissions]);

  const homeworkAssignments = useMemo(() => state.assignments || [], [state.assignments]);

  const selectedAssignment = useMemo(() => {
    return homeworkAssignments.find((item) => item.id === selectedAssignmentId) || homeworkAssignments[0] || null;
  }, [homeworkAssignments, selectedAssignmentId]);

  const adminMaps = useMemo(() => {
    return {
      assignments: Object.fromEntries((dashboard?.assignments || []).map((item) => [item.id, item])),
      students: Object.fromEntries((dashboard?.students || []).map((item) => [item.id, item]))
    };
  }, [dashboard]);

  const htmlImportInfo = useMemo(() => inspectHtml(importDraft.html), [importDraft.html]);

  const refreshState = useCallback(async (courseId = activeCourseId, studentId = student?.id) => {
    const query = new URLSearchParams();
    if (courseId) query.set('courseId', courseId);
    if (studentId) query.set('studentId', studentId);
    const next = await api(`/api/state?${query.toString()}`);
    setState(next);
    if (next.course?.id) {
      setActiveCourseId(next.course.id);
      localStorage.setItem(ACTIVE_COURSE_KEY, next.course.id);
    }
    if (next.student) {
      setStudent(next.student);
      saveStudent(next.student);
    }
  }, [activeCourseId, student?.id]);

  const refreshDashboard = useCallback(async () => {
    const next = await api('/api/admin/dashboard');
    setDashboard(next);
    setAdminLoggedIn(true);
  }, []);

  const checkAccess = useCallback(async () => {
    setAccessChecking(true);
    try {
      const next = await api('/api/access/status');
      setAccessAllowed(Boolean(next.allowed));
      if (next.allowed) localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ ip: next.ip || '', at: Date.now() }));
      else localStorage.removeItem(ACCESS_CACHE_KEY);
    } catch {
      setAccessAllowed(false);
      localStorage.removeItem(ACCESS_CACHE_KEY);
    } finally {
      setAccessChecking(false);
    }
  }, []);

  useEffect(() => {
    checkAccess();
  }, [checkAccess]);

  useEffect(() => {
    if (!accessAllowed) return;
    refreshState(activeCourseId).catch(() => setToast('Сервер не отвечает'));
  }, [accessAllowed]);

  useEffect(() => {
    if (!accessAllowed) return;
    const next = loadProgress(activeCourseId);
    next.sessions += 1;
    next.activeDays = Array.from(new Set([...(next.activeDays || []), todayKey()])).slice(-30);
    setProgress(next);
    saveProgress(activeCourseId, next);
  }, [accessAllowed, activeCourseId]);

  useEffect(() => {
    if (!homeworkAssignments.length) {
      setSelectedAssignmentId('');
      return;
    }
    if (!homeworkAssignments.some((item) => item.id === selectedAssignmentId)) {
      setSelectedAssignmentId(homeworkAssignments[0].id);
    }
  }, [homeworkAssignments, selectedAssignmentId]);

  useEffect(() => {
    saveSolutionDrafts(solutionDrafts);
  }, [solutionDrafts]);

  useEffect(() => {
    setImportDraft((draft) => ({ ...draft, courseId: activeCourseId }));
    setTaskDraft((draft) => (draft.courseId ? draft : { ...draft, courseId: activeCourseId }));
    setTopicNoteDraft((draft) => ({ ...draft, courseId: activeCourseId }));
    setEditorCourseId(activeCourseId);
  }, [activeCourseId]);

  useEffect(() => {
    if (adminLoggedIn && adminTab === 'editor') {
      loadCourseEditor(editorCourseId).catch(() => setEditorError('Не получилось загрузить редактор курса.'));
    }
  }, [adminLoggedIn, adminTab, editorCourseId]);

  const updateProgress = (updater) => {
    setProgress((previous) => {
      const next = typeof updater === 'function' ? updater(previous) : updater;
      saveProgress(activeCourseId, next);
      return next;
    });
  };

  const chooseCourse = async (courseId) => {
    setActiveCourseId(courseId);
    localStorage.setItem(ACTIVE_COURSE_KEY, courseId);
    setProgress(loadProgress(courseId));
    setSections([]);
    setCurrentTopicId('');
    await refreshState(courseId);
    setView('learn');
  };

  const setSide = (open) => {
    setSideOpen(open);
    localStorage.setItem(SIDE_KEY, String(open));
  };

  const jumpToTopic = useCallback((topicId, behavior = 'smooth') => {
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    const node = doc?.getElementById(topicId);
    if (!node || !win) return;
    win.scrollTo({ top: Math.max(node.offsetTop - 12, 0), behavior });
    setCurrentTopicId(topicId);
    updateProgress((previous) => ({ ...previous, lastTopic: topicId }));
  }, [activeCourseId]);

  const handleFrameLoad = useCallback(() => {
    cleanupFrameRef.current?.();
    const frame = frameRef.current;
    const doc = frame?.contentDocument;
    const win = frame?.contentWindow;
    if (!doc || !win) return;

    const style = doc.createElement('style');
    style.textContent = `
      html{scroll-padding-top:18px;scrollbar-width:none}
      html::-webkit-scrollbar,body::-webkit-scrollbar{width:0;height:0}
      body{overflow-wrap:anywhere;background:#fffdf8!important}
      .site-header,.hero,.sidebar{display:none!important}
      .layout{display:block!important;max-width:none!important;margin:0!important}
      .main{max-width:1380px!important;width:100%!important;margin:0 auto!important;padding:18px clamp(18px,3vw,42px) 80px!important}
      .section{scroll-margin-top:12px!important;margin-bottom:44px!important}
      .section-head{margin-top:0!important}
      .section-title{font-size:clamp(26px,3vw,40px)!important}
      .cards{grid-template-columns:repeat(4,minmax(0,1fr))!important;gap:14px!important}
      .table-wrap{max-width:100%;overflow-x:auto}
      img,svg,canvas{max-width:100%;height:auto}
      @media(max-width:1100px){.cards{grid-template-columns:repeat(2,minmax(0,1fr))!important}}
      @media(max-width:720px){.main{padding:16px 14px 72px!important}.section{margin-bottom:36px!important}.section-head{gap:10px!important}.drop-cap{font-size:50px!important}.cards{grid-template-columns:1fr!important}}`;
    doc.head.appendChild(style);

    let nodes = Array.from(doc.querySelectorAll('main .section[id], .part-divider[id]'));
    if (!nodes.length) {
      nodes = Array.from(doc.querySelectorAll('main h1,main h2,main h3,body h1,body h2,body h3'));
    }
    nodes.forEach((node, index) => {
      if (!node.id) node.id = `topic-${index + 1}`;
    });
    const parsed = nodes.map((node, index) => ({
      id: node.id,
      title: cleanText(node.querySelector?.('.section-title,.part-divider-title,h1,h2,h3')?.textContent || node.textContent) || `Тема ${index + 1}`,
      meta: cleanText(node.querySelector?.('.section-period,.section-tag,.part-divider-label')?.textContent),
      text: cleanText(node.textContent)
    }));

    const updateActive = () => {
      const y = win.scrollY + 120;
      let active = parsed[0]?.id || '';
      for (const topic of parsed) {
        const node = doc.getElementById(topic.id);
        if (node && node.offsetTop <= y) active = topic.id;
      }
      setCurrentTopicId(active);
      updateProgress((previous) => ({ ...previous, lastTopic: active, lastScroll: Math.round(win.scrollY) }));
    };

    win.addEventListener('scroll', updateActive, { passive: true });
    cleanupFrameRef.current = () => win.removeEventListener('scroll', updateActive);
    setSections(parsed);

    requestAnimationFrame(() => {
      const saved = loadProgress(activeCourseId);
      if (saved.lastTopic && doc.getElementById(saved.lastTopic)) jumpToTopic(saved.lastTopic, 'auto');
      else if (saved.lastScroll) win.scrollTo(0, saved.lastScroll);
      updateActive();
    });
  }, [activeCourseId, jumpToTopic]);

  useEffect(() => () => cleanupFrameRef.current?.(), []);

  const markTopic = (status) => {
    if (!currentTopic) return;
    updateProgress((previous) => ({ ...previous, statuses: { ...previous.statuses, [currentTopic.id]: status } }));
  };

  const registerStudent = async (event) => {
    event.preventDefault();
    const next = await api('/api/students', { method: 'POST', body: { ...studentForm, courseId: activeCourseId, forceNew: forceNewStudent } });
    setStudent(next.student);
    saveStudent(next.student);
    setState(next.state);
    setForceNewStudent(false);
    setToast('Профиль готов. Можно сдавать ДЗ.');
  };

  const changeStudentAccount = () => {
    setStudentForm({ name: student?.name || '', telegram: '' });
    setStudent(null);
    saveStudent(null);
    setForceNewStudent(true);
    setState((previous) => ({ ...previous, submissions: [], student: null }));
    setToast('Введи аккаунт заново. Сайт выдаст новый код для бота.');
  };

  const loginAccess = async (event) => {
    event.preventDefault();
    setAccessError('');
    try {
      const next = await api('/api/access/login', { method: 'POST', body: { password: accessPassword } });
      localStorage.setItem(ACCESS_CACHE_KEY, JSON.stringify({ ip: next.ip || '', at: Date.now() }));
      setAccessPassword('');
      setAccessAllowed(true);
      await refreshState(activeCourseId).catch(() => setToast('Сервер не отвечает'));
    } catch {
      setAccessError('Пароль не подошел.');
    }
  };

  const updateSolutionDraft = (assignmentId, value) => {
    setSolutionDrafts((drafts) => ({ ...drafts, [assignmentId]: value }));
  };

  const saveCurrentDraft = (assignmentId) => {
    saveSolutionDrafts({ ...solutionDrafts, [assignmentId]: solutionDrafts[assignmentId] || '' });
    setToast('Черновик сохранен на этом устройстве.');
  };

  const submitHomework = async (assignmentId) => {
    if (!student) {
      setToast('Сначала заполни имя и Telegram');
      return;
    }
    const answer = solutionDrafts[assignmentId] ?? submissionsByTask[assignmentId]?.answer ?? '';
    if (!cleanText(answer)) {
      setToast('Сначала напиши решение.');
      return;
    }
    try {
      const next = await api('/api/submissions', {
        method: 'POST',
        body: { assignmentId, studentId: student.id, courseId: activeCourseId, answer }
      });
      setState(next);
      setToast('Ответ сохранен.');
    } catch {
      setToast('Не получилось сдать. Проверь, что решение не слишком короткое.');
    }
  };

  const loginAdmin = async (event) => {
    event.preventDefault();
    setAdminError('');
    try {
      await api('/api/admin/login', { method: 'POST', body: adminLogin });
      setAdminLogin({ ...adminLogin, password: '' });
      await refreshDashboard();
    } catch {
      setAdminError('Не вошло. Проверь пароль.');
    }
  };

  const setupAdmin = async (event) => {
    event.preventDefault();
    setAdminError('');
    if (adminSetup.password !== adminSetup.repeat) {
      setAdminError('Пароли не совпали.');
      return;
    }
    try {
      await api('/api/admin/setup', { method: 'POST', body: adminSetup });
      await refreshState(activeCourseId);
      await refreshDashboard();
    } catch {
      setAdminError('Не получилось сохранить пароль.');
    }
  };

  const openAdmin = async () => {
    setView('admin');
    refreshDashboard().catch(() => setAdminLoggedIn(false));
  };

  const createCourse = async (event) => {
    event.preventDefault();
    const next = await api('/api/admin/courses', { method: 'POST', body: courseDraft });
    setDashboard(next);
    setCourseDraft({ title: '', subtitle: '' });
    await refreshState(activeCourseId);
    setToast('Курс добавлен.');
  };

  const fetchCourseEditor = async (courseId) => {
    const next = await api(`/api/admin/course-editor?courseId=${encodeURIComponent(courseId)}`);
    return normalizeEditorDraft(next.editor, adminCourses.find((course) => course.id === courseId) || activeCourse);
  };

  const loadCourseEditor = async (courseId = editorCourseId) => {
    setEditorError('');
    const draft = await fetchCourseEditor(courseId);
    setCourseEditor(draft);
    setEditorCourseId(draft.courseId || courseId);
    setSelectedEditorSectionId(draft.sections[0]?.id || '');
    setEditorDirty(false);
  };

  useEffect(() => {
    if (!adminLoggedIn || adminTab !== 'tasks' || !taskDraft.courseId) return;
    let cancelled = false;
    setTaskError('');
    fetchCourseEditor(taskDraft.courseId)
      .then((draft) => {
        if (cancelled) return;
        setTaskCourseEditor(draft);
        if (taskDraft.topicId && !draft.sections.some((section) => section.id === taskDraft.topicId)) {
          setTaskDraft((previous) => ({ ...previous, topicId: '' }));
        }
      })
      .catch(() => {
        if (!cancelled) setTaskError('Не получилось загрузить темы выбранного курса.');
      });
    return () => {
      cancelled = true;
    };
  }, [adminLoggedIn, adminTab, taskDraft.courseId]);

  const updateCourseEditor = (updater) => {
    setCourseEditor((previous) => {
      const base = normalizeEditorDraft(previous, adminCourses.find((course) => course.id === editorCourseId) || activeCourse);
      return typeof updater === 'function' ? updater(base) : updater;
    });
    setEditorDirty(true);
  };

  const updateEditorSection = (sectionId, patch) => {
    updateCourseEditor((editor) => ({
      ...editor,
      sections: editor.sections.map((section) => section.id === sectionId ? { ...section, ...patch } : section)
    }));
  };

  const updateEditorBlock = (sectionId, blockId, patch) => {
    updateCourseEditor((editor) => ({
      ...editor,
      sections: editor.sections.map((section) => section.id === sectionId ? {
        ...section,
        blocks: section.blocks.map((block) => block.id === blockId ? { ...block, ...patch } : block)
      } : section)
    }));
  };

  const addEditorSection = () => {
    const section = createEditorSection(`Тема ${(courseEditor?.sections?.length || 0) + 1}`);
    updateCourseEditor((editor) => ({ ...editor, sections: [...editor.sections, section] }));
    setSelectedEditorSectionId(section.id);
  };

  const removeEditorSection = (sectionId) => {
    const section = courseEditor?.sections?.find((item) => item.id === sectionId);
    if (!section || !window.confirm(`Удалить тему "${section.title}"?`)) return;
    updateCourseEditor((editor) => {
      const sectionsLeft = editor.sections.filter((item) => item.id !== sectionId);
      setSelectedEditorSectionId(sectionsLeft[0]?.id || '');
      return { ...editor, sections: sectionsLeft.length ? sectionsLeft : [createEditorSection('Первая тема')] };
    });
  };

  const moveEditorSection = (sectionId, direction) => {
    updateCourseEditor((editor) => {
      const index = editor.sections.findIndex((section) => section.id === sectionId);
      return { ...editor, sections: moveItem(editor.sections, index, direction) };
    });
  };

  const addEditorBlock = (sectionId, type) => {
    const block = createEditorBlock(type);
    updateCourseEditor((editor) => ({
      ...editor,
      sections: editor.sections.map((section) => section.id === sectionId ? { ...section, blocks: [...section.blocks, block] } : section)
    }));
  };

  const removeEditorBlock = (sectionId, blockId) => {
    if (!window.confirm('Удалить этот блок?')) return;
    updateCourseEditor((editor) => ({
      ...editor,
      sections: editor.sections.map((section) => section.id === sectionId ? {
        ...section,
        blocks: section.blocks.filter((block) => block.id !== blockId)
      } : section)
    }));
  };

  const moveEditorBlock = (sectionId, blockId, direction) => {
    updateCourseEditor((editor) => ({
      ...editor,
      sections: editor.sections.map((section) => {
        if (section.id !== sectionId) return section;
        const index = section.blocks.findIndex((block) => block.id === blockId);
        return { ...section, blocks: moveItem(section.blocks, index, direction) };
      })
    }));
  };

  const saveCourseEditor = async () => {
    if (!courseEditor) return;
    setEditorSaving(true);
    setEditorError('');
    try {
      const next = await api('/api/admin/course-editor', {
        method: 'POST',
        body: { courseId: editorCourseId, editor: courseEditor }
      });
      setDashboard(next.dashboard);
      setCourseEditor(next.editor);
      if (taskDraft.courseId === editorCourseId) setTaskCourseEditor(next.editor);
      setState(next.state);
      setActiveCourseId(editorCourseId);
      localStorage.setItem(ACTIVE_COURSE_KEY, editorCourseId);
      setEditorDirty(false);
      setSections([]);
      setCurrentTopicId('');
      setToast('Курс сохранен и опубликован.');
    } catch (error) {
      setEditorError('Не получилось сохранить. Проверь, что есть название курса, темы и блоки.');
    } finally {
      setEditorSaving(false);
    }
  };

  const readHtmlFile = async (file) => {
    if (!file) return;
    const html = await file.text();
    setImportDraft((draft) => ({ ...draft, html, title: draft.title || file.name.replace(/\.[^.]+$/, '') }));
  };

  const importHtml = async (event) => {
    event.preventDefault();
    const next = await api('/api/admin/import-html', { method: 'POST', body: importDraft });
    setDashboard(next);
    setImportDraft((draft) => ({ ...draft, html: '' }));
    await refreshState(importDraft.courseId);
    setToast('HTML импортирован. Темы появятся при открытии курса.');
  };

  const generateTask = () => {
    const topic = taskTopics.find((item) => item.id === taskDraft.topicId) || taskTopics[0] || null;
    const generated = createGeneratedTask(topic, taskCourse);
    setTaskDraft((draft) => ({ ...draft, ...generated, topicId: draft.topicId || topic?.id || '' }));
  };

  const createAssignment = async (event) => {
    event.preventDefault();
    const courseId = taskDraft.courseId || activeCourseId;
    const topic = taskTopics.find((item) => item.id === taskDraft.topicId);
    const next = await api('/api/admin/assignments', {
      method: 'POST',
      body: { ...taskDraft, courseId, topicTitle: topic?.title || '' }
    });
    setDashboard(next);
    setTaskDraft((draft) => ({ ...draft, courseId, topicId: taskDraft.topicId, title: '', body: '', deadline: defaultDeadline() }));
    if (courseId === activeCourseId) await refreshState(activeCourseId);
    setToast('ДЗ опубликовано.');
  };

  const toggleAssignment = async (assignment) => {
    const next = await api(`/api/admin/assignments/${assignment.id}`, {
      method: 'POST',
      body: { status: assignment.status === 'closed' ? 'open' : 'closed' }
    });
    setDashboard(next);
    await refreshState(activeCourseId);
  };

  const saveTopicNote = async (event) => {
    event.preventDefault();
    const next = await api('/api/admin/topic-note', { method: 'POST', body: topicNoteDraft });
    setDashboard(next);
    await refreshState(activeCourseId);
    setToast('Подсказка сохранена.');
  };

  const saveFeedback = async (submissionId) => {
    const next = await api('/api/admin/feedback', {
      method: 'POST',
      body: { submissionId, feedback: feedbackDrafts[submissionId] || '' }
    });
    setDashboard(next);
    await refreshState(activeCourseId);
    setToast('Фидбек отправлен.');
  };

  const selectedEditorSection = useMemo(() => {
    return courseEditor?.sections?.find((section) => section.id === selectedEditorSectionId) || courseEditor?.sections?.[0] || null;
  }, [courseEditor, selectedEditorSectionId]);

  const editorProblems = useMemo(() => {
    const problems = [];
    if (courseEditor && cleanText(courseEditor.title).length < 3) problems.push('Название курса слишком короткое.');
    for (const section of courseEditor?.sections || []) {
      if (cleanText(section.title).length < 3) problems.push('Есть тема без нормального названия.');
      if (!section.blocks?.length) problems.push(`В теме "${section.title}" нет блоков.`);
      for (const block of section.blocks || []) {
        if (block.type === 'text' && cleanText(block.text).length < 3) problems.push(`Пустой текстовый блок в теме "${section.title}".`);
        if (block.type === 'list' && !(block.items || []).filter(Boolean).length) problems.push(`Пустой список в теме "${section.title}".`);
        if (block.type === 'cards' && !(block.cards || []).filter((card) => card.title || card.text).length) problems.push(`Пустые карточки в теме "${section.title}".`);
      }
    }
    return problems.slice(0, 8);
  }, [courseEditor]);

  const currentNote = currentTopic ? state.topicNotes?.[currentTopic.id] : '';

  if (accessChecking) {
    return (
      <main className="access-screen">
        <section className="access-card">
          <p>закрытый курс</p>
          <h1>Проверяем доступ</h1>
          <span>Секунду, сверяю локальный пропуск.</span>
        </section>
      </main>
    );
  }

  if (!accessAllowed) {
    return (
      <main className="access-screen">
        <form className="access-card" onSubmit={loginAccess}>
          <p>закрытый курс</p>
          <h1>Вход по паролю</h1>
          <span>После входа это устройство и IP будут пускаться сразу.</span>
          <label>
            Пароль
            <input
              autoFocus
              onChange={(event) => setAccessPassword(event.target.value)}
              type="password"
              value={accessPassword}
            />
          </label>
          <button type="submit">Открыть сайт</button>
          {accessError ? <strong className="error-text">{accessError}</strong> : null}
        </form>
      </main>
    );
  }

  return (
    <div className={`app-shell view-${view}`}>
      <header className="topbar">
        <button className="brand-button" onClick={() => setView('catalog')} type="button">
          <span>© Туманян Оганнес · 2026</span>
          <strong>{activeCourse?.title || 'Выберите курс'}</strong>
        </button>
        <nav className="main-tabs" aria-label="Главные разделы">
          <button className={view === 'catalog' ? 'active' : ''} onClick={() => setView('catalog')} type="button">Курсы</button>
          <button className={view === 'learn' ? 'active' : ''} onClick={() => setView('learn')} type="button">Учусь</button>
          <button className={view === 'homework' ? 'active' : ''} onClick={() => setView('homework')} type="button">ДЗ</button>
          <button className={view === 'admin' ? 'active' : ''} onClick={openAdmin} type="button">Админ</button>
        </nav>
      </header>

      {toast ? <button className="toast" onClick={() => setToast('')} type="button">{toast}</button> : null}

      {view === 'catalog' ? (
        <main className="catalog-view">
          <section className="catalog-hero">
            <p>старт</p>
            <h1>Выберите курс</h1>
            <span>Первый раздел готов к учебе.</span>
          </section>
          <div className="course-grid">
            {(state.courses || []).map((course) => (
              <button className="course-card" key={course.id} onClick={() => chooseCourse(course.id)} type="button">
                <span>{course.id === 'iogp' ? 'текущий раздел' : 'курс'}</span>
                <strong>{course.title}</strong>
                <em>{course.subtitle || 'Без описания'}</em>
              </button>
            ))}
          </div>
        </main>
      ) : null}

      {view === 'learn' ? (
        <main className={sideOpen ? 'learn-view' : 'learn-view side-closed'}>
          {sideOpen ? (
            <aside className="course-side">
              <div className="side-head">
                <div>
                  <p>курс</p>
                  <h2>{activeCourse?.title}</h2>
                </div>
                <button onClick={() => setSide(false)} type="button">скрыть</button>
              </div>
              {currentNote ? <div className="teacher-note"><p>для сдачи</p><strong>{currentNote}</strong></div> : null}
              <div className="status-card">
                <h3>Статус темы</h3>
                <div className="big-status-grid">
                  {Object.entries(STATUS_META).map(([status, meta]) => (
                    <button
                      className={(progress.statuses[currentTopic?.id] || 'new') === status ? 'active' : ''}
                      key={status}
                      onClick={() => markTopic(status)}
                      type="button"
                    >
                      {meta.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="topic-list">
                {sections.map((topic) => (
                  <button className={topic.id === currentTopic?.id ? 'active' : ''} key={topic.id} onClick={() => jumpToTopic(topic.id)} type="button">
                    <span>{topic.title}</span>
                    <em>{STATUS_META[progress.statuses[topic.id] || 'new'].label}</em>
                  </button>
                ))}
              </div>
            </aside>
          ) : null}

          <section className="course-stage">
            <div className="course-toolbar">
              <button onClick={() => setSide(true)} type="button">☰ Темы</button>
              <strong>{currentTopic?.title || activeCourse?.title}</strong>
              <span>{progressStats.percent}%</span>
            </div>
            <iframe
              className="course-frame"
              key={activeCourseId}
              onLoad={handleFrameLoad}
              ref={frameRef}
              sandbox="allow-same-origin"
              src={`/ogannes/course-content/${encodeURIComponent(activeCourseId)}`}
              title={`Курс ${activeCourse?.title || ''}`}
            />
          </section>
        </main>
      ) : null}

      {view === 'homework' ? (
        <main className="homework-view">
          <div className="homework-head">
            <div>
              <p>{activeCourse?.title}</p>
              <h1>Домашка и фидбек</h1>
            </div>
            <a href={state.bot?.link || 'https://t.me/OgannesStudy_bot'} rel="noreferrer" target="_blank">Открыть бота</a>
          </div>

          {!student ? (
            <form className="student-card" onSubmit={registerStudent}>
              <h2>Кто сдает?</h2>
              <label>Имя<input required value={studentForm.name} onChange={(event) => setStudentForm({ ...studentForm, name: event.target.value })} /></label>
              <label>Telegram<input placeholder="@username" value={studentForm.telegram} onChange={(event) => setStudentForm({ ...studentForm, telegram: event.target.value })} /></label>
              <button type="submit">Начать сдавать</button>
            </form>
          ) : (
            <section className="student-card">
              <div className="student-profile-row">
                <div><p>профиль</p><h2>{student.name}</h2><span>{student.telegram || 'Telegram не указан'}</span></div>
                <button className="ghost-button" onClick={changeStudentAccount} type="button">сменить аккаунт</button>
              </div>
              <div className="bot-code"><span>код для бота</span><strong>{student.botCode}</strong></div>
              <p className="muted">Отправь этот код в Telegram-бота. Потом туда будет приходить фидбек.</p>
            </section>
          )}

          {homeworkAssignments.length ? (
            <section className="homework-board">
              <aside className="assignment-rail" aria-label="Список заданий">
                {homeworkAssignments.map((assignment, index) => {
                  const submission = submissionsByTask[assignment.id];
                  const hasDraft = cleanText(solutionDrafts[assignment.id] ?? submission?.answer ?? '');
                  return (
                    <button
                      aria-pressed={selectedAssignment?.id === assignment.id}
                      className={selectedAssignment?.id === assignment.id ? 'active' : ''}
                      key={assignment.id}
                      onClick={() => setSelectedAssignmentId(assignment.id)}
                      type="button"
                    >
                      <span>Задача {index + 1}</span>
                      <strong>{assignment.title}</strong>
                      <em>{submission?.feedback ? 'проверено' : submission ? 'ждет проверки' : hasDraft ? 'черновик' : formatDeadline(assignment.deadline)}</em>
                    </button>
                  );
                })}
              </aside>

              {selectedAssignment ? (() => {
                const submission = submissionsByTask[selectedAssignment.id];
                const draft = solutionDrafts[selectedAssignment.id] ?? submission?.answer ?? '';
                return (
                  <section className="solution-workspace">
                    <div className="problem-statement">
                      <div className="assignment-title">
                        <div>
                          <p>{selectedAssignment.topicTitle || activeCourse?.title}</p>
                          <h2>{selectedAssignment.title}</h2>
                        </div>
                        <time>{formatDeadline(selectedAssignment.deadline)}</time>
                      </div>
                      <p>{selectedAssignment.body}</p>
                    </div>

                    <label className="solution-field">
                      Решение
                      <textarea
                        className="solution-textarea"
                        disabled={!student}
                        onChange={(event) => updateSolutionDraft(selectedAssignment.id, event.target.value)}
                        placeholder="Пиши как на олимпиаде: идея, ход решения, ответ. Можно сначала накидать черновик, потом сдать."
                        value={draft}
                      />
                    </label>

                    <div className="solution-toolbar">
                      <button disabled={!student} onClick={() => saveCurrentDraft(selectedAssignment.id)} type="button">сохранить черновик</button>
                      <button disabled={!student} onClick={() => submitHomework(selectedAssignment.id)} type="button">{submission ? 'обновить сдачу' : 'сдать решение'}</button>
                      <span className="solution-status">{submission?.feedback ? 'фидбек есть' : submission ? 'отправлено на проверку' : cleanText(draft) ? 'черновик на устройстве' : 'пока пусто'}</span>
                    </div>

                    {submission?.feedback ? <div className="feedback-box">{submission.feedback}</div> : null}

                    <div className="solution-help">
                      <span>Шаблон ответа</span>
                      <ol>
                        <li>Что дано и что нужно доказать или найти.</li>
                        <li>Главная идея решения.</li>
                        <li>Пошаговый ход рассуждений.</li>
                        <li>Короткий итоговый ответ.</li>
                      </ol>
                    </div>
                  </section>
                );
              })() : null}
            </section>
          ) : <p className="empty-state">Открытых заданий по этому курсу нет.</p>}
        </main>
      ) : null}

      {view === 'admin' ? (
        <main className="admin-view">
          {!adminLoggedIn ? (
            state.adminNeedsSetup ? (
              <form className="login-card" onSubmit={setupAdmin}>
                <p>первый запуск</p><h1>Задать вход</h1>
                <label>Логин<input value={adminSetup.username} onChange={(event) => setAdminSetup({ ...adminSetup, username: event.target.value })} /></label>
                <label>Пароль<input type="password" value={adminSetup.password} onChange={(event) => setAdminSetup({ ...adminSetup, password: event.target.value })} /></label>
                <label>Повтори пароль<input type="password" value={adminSetup.repeat} onChange={(event) => setAdminSetup({ ...adminSetup, repeat: event.target.value })} /></label>
                <button type="submit">сохранить и войти</button>
                {adminError ? <span className="error-text">{adminError}</span> : null}
              </form>
            ) : (
              <form className="login-card" onSubmit={loginAdmin}>
                <p>админка</p><h1>Вход</h1>
                <label>Логин<input value={adminLogin.username} onChange={(event) => setAdminLogin({ ...adminLogin, username: event.target.value })} /></label>
                <label>Пароль<input type="password" value={adminLogin.password} onChange={(event) => setAdminLogin({ ...adminLogin, password: event.target.value })} /></label>
                <button type="submit">Войти</button>
                {adminError ? <span className="error-text">{adminError}</span> : null}
              </form>
            )
          ) : (
            <>
              <div className="admin-head">
                <nav>
                  {['courses', 'editor', 'import', 'tasks', 'answers', 'notes'].map((tab) => (
                    <button className={adminTab === tab ? 'active' : ''} key={tab} onClick={() => setAdminTab(tab)} type="button">
                      {{ courses: 'Курсы', editor: 'Редактор', import: 'HTML-импорт', tasks: 'Задания', answers: 'Ответы', notes: 'Подсказки' }[tab]}
                    </button>
                  ))}
                </nav>
              </div>

              {adminTab === 'courses' ? (
                <div className="admin-grid">
                  <form className="editor-card" onSubmit={createCourse}>
                    <h2>Добавить курс</h2>
                    <label>Название<input required value={courseDraft.title} onChange={(event) => setCourseDraft({ ...courseDraft, title: event.target.value })} /></label>
                    <label>Описание<input value={courseDraft.subtitle} onChange={(event) => setCourseDraft({ ...courseDraft, subtitle: event.target.value })} /></label>
                    <button type="submit">добавить</button>
                  </form>
                  <div className="admin-list">
                    {(dashboard?.courses || []).map((course) => (
                      <article key={course.id}><p>{course.id}</p><h3>{course.title}</h3><span>{course.subtitle}</span></article>
                    ))}
                  </div>
                </div>
              ) : null}

              {adminTab === 'editor' ? (
                <section className="course-editor-screen">
                  <div className="editor-topline">
                    <label>Курс
                      <select value={editorCourseId} onChange={(event) => setEditorCourseId(event.target.value)}>
                        {adminCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                      </select>
                    </label>
                    <div className="editor-status">
                      <span>{editorDirty ? 'есть несохраненные изменения' : 'сохранено'}</span>
                      <button type="button" onClick={() => loadCourseEditor(editorCourseId)}>загрузить</button>
                      <button type="button" onClick={() => setEditorPreviewOpen((open) => !open)}>{editorPreviewOpen ? 'скрыть предпросмотр' : 'показать предпросмотр'}</button>
                      <button disabled={editorSaving || editorProblems.length > 0} type="button" onClick={saveCourseEditor}>{editorSaving ? 'сохраняю...' : 'сохранить и опубликовать'}</button>
                      <button type="button" onClick={() => { setActiveCourseId(editorCourseId); setView('learn'); }}>открыть курс</button>
                    </div>
                  </div>

                  {!courseEditor ? (
                    <div className="empty-state">Выбери курс и нажми «загрузить».</div>
                  ) : (
                    <div className={`course-editor-grid ${editorPreviewOpen ? 'preview-open' : ''}`}>
                      <aside className="editor-outline">
                        <details className="editor-meta">
                          <summary>Параметры курса</summary>
                          <label>Название курса<input value={courseEditor.title} onChange={(event) => updateCourseEditor((editor) => ({ ...editor, title: event.target.value }))} /></label>
                          <label>Описание<input value={courseEditor.subtitle || ''} onChange={(event) => updateCourseEditor((editor) => ({ ...editor, subtitle: event.target.value }))} /></label>
                          <label>Автор<input value={courseEditor.author || ''} onChange={(event) => updateCourseEditor((editor) => ({ ...editor, author: event.target.value }))} /></label>
                        </details>
                        <div className="outline-head">
                          <strong>Темы</strong>
                          <button type="button" onClick={addEditorSection}>+ тема</button>
                        </div>
                        <div className="outline-list">
                          {courseEditor.sections.map((section, index) => (
                            <button className={section.id === selectedEditorSection?.id ? 'active' : ''} key={section.id} onClick={() => setSelectedEditorSectionId(section.id)} type="button">
                              <span>{index + 1}. {section.title}</span>
                              <em>{section.blocks.length} блоков</em>
                            </button>
                          ))}
                        </div>
                      </aside>

                      <section className="editor-workspace">
                        {selectedEditorSection ? (
                          <>
                            <div className="topic-editor-head">
                              <label>Название темы<input value={selectedEditorSection.title} onChange={(event) => updateEditorSection(selectedEditorSection.id, { title: event.target.value })} /></label>
                              <label>Период / подпись<input value={selectedEditorSection.period || ''} onChange={(event) => updateEditorSection(selectedEditorSection.id, { period: event.target.value })} /></label>
                              <div className="row-actions">
                                <button type="button" onClick={() => moveEditorSection(selectedEditorSection.id, -1)}>выше</button>
                                <button type="button" onClick={() => moveEditorSection(selectedEditorSection.id, 1)}>ниже</button>
                                <button type="button" onClick={() => removeEditorSection(selectedEditorSection.id)}>удалить тему</button>
                              </div>
                            </div>

                            <div className="block-add-row">
                              {['text', 'cards', 'list', 'quote'].map((type) => (
                                <button key={type} type="button" onClick={() => addEditorBlock(selectedEditorSection.id, type)}>+ {blockLabel(type)}</button>
                              ))}
                            </div>

                            <div className="block-editor-list">
                              {selectedEditorSection.blocks.map((block, blockIndex) => (
                                <article className="block-editor" key={block.id}>
                                  <div className="block-editor-head">
                                    <strong>{blockIndex + 1}. {blockLabel(block.type)}</strong>
                                    <div>
                                      <button type="button" onClick={() => moveEditorBlock(selectedEditorSection.id, block.id, -1)}>↑</button>
                                      <button type="button" onClick={() => moveEditorBlock(selectedEditorSection.id, block.id, 1)}>↓</button>
                                      <button type="button" onClick={() => removeEditorBlock(selectedEditorSection.id, block.id)}>удалить</button>
                                    </div>
                                  </div>
                                  <label>Тип
                                    <select value={block.type} onChange={(event) => updateEditorBlock(selectedEditorSection.id, block.id, createEditorBlock(event.target.value))}>
                                      <option value="text">Текст</option>
                                      <option value="cards">Карточки</option>
                                      <option value="list">Список</option>
                                      <option value="quote">Цитата</option>
                                    </select>
                                  </label>
                                  {block.type !== 'text' ? <label>Заголовок блока<input value={block.title || ''} onChange={(event) => updateEditorBlock(selectedEditorSection.id, block.id, { title: event.target.value })} /></label> : null}
                                  {block.type === 'text' || block.type === 'quote' ? (
                                    <label>Текст<textarea value={block.text || ''} onChange={(event) => updateEditorBlock(selectedEditorSection.id, block.id, { text: event.target.value })} /></label>
                                  ) : null}
                                  {block.type === 'list' ? (
                                    <label>Пункты, каждый с новой строки
                                      <textarea value={(block.items || []).join('\n')} onChange={(event) => updateEditorBlock(selectedEditorSection.id, block.id, { items: event.target.value.split('\n') })} />
                                    </label>
                                  ) : null}
                                  {block.type === 'cards' ? (
                                    <label>Карточки: заголовок — текст
                                      <textarea value={(block.cards || []).map((card) => `${card.title} — ${card.text}`).join('\n')} onChange={(event) => updateEditorBlock(selectedEditorSection.id, block.id, {
                                        cards: event.target.value.split('\n').map((line) => {
                                          const [title, ...rest] = line.split('—');
                                          return { title: cleanText(title), text: cleanText(rest.join('—')) };
                                        })
                                      })} />
                                    </label>
                                  ) : null}
                                </article>
                              ))}
                            </div>
                          </>
                        ) : <div className="empty-state">Создай первую тему.</div>}
                      </section>

                      <aside className={`editor-preview ${editorPreviewOpen ? '' : 'is-closed'}`}>
                        <h2>Предпросмотр</h2>
                        {editorProblems.length ? (
                          <div className="validation-box">
                            <strong>Перед сохранением поправь:</strong>
                            {editorProblems.map((problem) => <span key={problem}>{problem}</span>)}
                          </div>
                        ) : <div className="validation-box ok">Можно сохранять.</div>}
                        {selectedEditorSection ? (
                          <div className="student-preview">
                            <p>{selectedEditorSection.period || courseEditor.subtitle}</p>
                            <h3>{selectedEditorSection.title}</h3>
                            {selectedEditorSection.blocks.map((block) => (
                              <div className={`preview-block preview-${block.type}`} key={block.id}>
                                {block.title ? <strong>{block.title}</strong> : null}
                                {block.type === 'text' || block.type === 'quote' ? cleanText(block.text).split('\n').filter(Boolean).map((line) => <p key={line}>{line}</p>) : null}
                                {block.type === 'list' ? <ul>{(block.items || []).filter(Boolean).map((item) => <li key={item}>{item}</li>)}</ul> : null}
                                {block.type === 'cards' ? <div className="preview-cards">{(block.cards || []).filter((card) => card.title || card.text).map((card, index) => <article key={`${card.title}-${index}`}><b>{card.title}</b><span>{card.text}</span></article>)}</div> : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                        {editorError ? <span className="error-text">{editorError}</span> : null}
                      </aside>
                    </div>
                  )}
                </section>
              ) : null}

              {adminTab === 'import' ? (
                <form className="editor-card wide-editor" onSubmit={importHtml}>
                  <h2>HTML-импорт</h2>
                  <label>Курс
                    <select value={importDraft.courseId} onChange={(event) => setImportDraft({ ...importDraft, courseId: event.target.value })}>
                      {adminCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                    </select>
                  </label>
                  <label>Название после импорта<input value={importDraft.title} onChange={(event) => setImportDraft({ ...importDraft, title: event.target.value })} /></label>
                  <label>HTML-файл<input accept=".html,.htm,text/html" type="file" onChange={(event) => readHtmlFile(event.target.files?.[0])} /></label>
                  <label>Или вставь HTML<textarea value={importDraft.html} onChange={(event) => setImportDraft({ ...importDraft, html: event.target.value })} /></label>
                  <div className="import-preview">
                    <span>{htmlImportInfo.length} символов</span>
                    <span>{htmlImportInfo.headings} будущих тем</span>
                    <span>{htmlImportInfo.scripts} опасных блоков будет удалено</span>
                  </div>
                  <button type="submit">импортировать HTML</button>
                </form>
              ) : null}

              {adminTab === 'tasks' ? (
                <div className="task-admin-grid">
                  <form className="editor-card task-editor" onSubmit={createAssignment}>
                    <h2>Новое ДЗ</h2>
                    <div className="task-course-strip">
                      <label>Курс
                        <select value={taskDraft.courseId} onChange={(event) => setTaskDraft({ ...taskDraft, courseId: event.target.value, topicId: '' })}>
                          {adminCourses.map((course) => <option key={course.id} value={course.id}>{course.title}</option>)}
                        </select>
                      </label>
                      <div>
                        <p>публикация</p>
                        <strong>{taskCourse?.title || 'курс не выбран'}</strong>
                      </div>
                    </div>
                    <label>Тема
                      <select value={taskDraft.topicId} onChange={(event) => setTaskDraft({ ...taskDraft, topicId: event.target.value })}>
                        <option value="">весь курс</option>
                        {taskTopics.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                      </select>
                    </label>
                    <label>Название<input required value={taskDraft.title} onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })} /></label>
                    <label>Текст задания<textarea className="task-body-input" required value={taskDraft.body} onChange={(event) => setTaskDraft({ ...taskDraft, body: event.target.value })} /></label>
                    <label>Дедлайн<input required type="datetime-local" value={taskDraft.deadline} onChange={(event) => setTaskDraft({ ...taskDraft, deadline: event.target.value })} /></label>
                    <div className="row-actions"><button type="button" onClick={generateTask}>сгенерировать</button><button type="submit">опубликовать</button></div>
                    {taskError ? <span className="error-text">{taskError}</span> : null}
                  </form>
                  <div className="admin-list task-list">
                    <div className="task-list-head">
                      <p>задания курса</p>
                      <h2>{taskCourse?.title || 'Курс'}</h2>
                    </div>
                    {(dashboard?.assignments || []).filter((item) => item.courseId === taskDraft.courseId).map((assignment) => (
                      <article key={assignment.id}>
                        <p>{assignment.topicTitle || 'весь курс'} · {formatDeadline(assignment.deadline)}</p>
                        <h3>{assignment.title}</h3>
                        <span>{assignment.status === 'closed' ? 'закрыто' : 'открыто'}</span>
                        <button onClick={() => toggleAssignment(assignment)} type="button">{assignment.status === 'closed' ? 'открыть' : 'закрыть'}</button>
                      </article>
                    ))}
                    {(dashboard?.assignments || []).some((item) => item.courseId === taskDraft.courseId) ? null : <p className="empty-state">У этого курса еще нет ДЗ.</p>}
                  </div>
                </div>
              ) : null}

              {adminTab === 'answers' ? (
                <div className="answers-list">
                  {(dashboard?.submissions || []).map((submission) => {
                    const assignment = adminMaps.assignments[submission.assignmentId];
                    const answerStudent = adminMaps.students[submission.studentId];
                    return (
                      <article className="answer-card" key={submission.id}>
                        <div><p>{answerStudent?.name || 'ученик'} · {assignment?.title || 'задание'}</p><h2>{submission.answer}</h2></div>
                        <textarea placeholder="Фидбек" value={feedbackDrafts[submission.id] ?? submission.feedback ?? ''} onChange={(event) => setFeedbackDrafts({ ...feedbackDrafts, [submission.id]: event.target.value })} />
                        <button type="button" onClick={() => saveFeedback(submission.id)}>отправить фидбек</button>
                      </article>
                    );
                  })}
                </div>
              ) : null}

              {adminTab === 'notes' ? (
                <form className="editor-card wide-editor" onSubmit={saveTopicNote}>
                  <h2>Подсказка к теме</h2>
                  <label>Тема
                    <select value={topicNoteDraft.topicId} onChange={(event) => setTopicNoteDraft({ ...topicNoteDraft, topicId: event.target.value, note: dashboard?.topicNotes?.[activeCourseId]?.[event.target.value] || '' })}>
                      <option value="">выбери тему</option>
                      {sections.map((topic) => <option key={topic.id} value={topic.id}>{topic.title}</option>)}
                    </select>
                  </label>
                  <label>Текст<textarea value={topicNoteDraft.note} onChange={(event) => setTopicNoteDraft({ ...topicNoteDraft, note: event.target.value })} /></label>
                  <button type="submit">сохранить подсказку</button>
                </form>
              ) : null}
            </>
          )}
        </main>
      ) : null}
    </div>
  );
}
