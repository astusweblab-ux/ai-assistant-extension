// sidepanel.js — Prompt API (Gemini Nano) с поддержкой нового и старого API

let session = null;
let isModelReady = false;
let isGenerating = false;
let isCreatingSession = false;
let promptApi = null;
let sessionLanguageOptions = null;
let selectedOutputLang = 'en';

const SUPPORTED_OUTPUT_LANGS = ['en', 'es', 'ja'];
const ASSISTANT_NAME = 'Local AI Assistant';
const ASSISTANT_CREATOR = 'ASTUS LAB';

function detectOutputLanguage() {
  const lang = String(navigator.language || '').toLowerCase();
  if (lang.startsWith('es')) return 'es';
  if (lang.startsWith('ja')) return 'ja';
  return 'en';
}

function getSessionLanguageOptions() {
  return {
    expectedOutputs: [
      { type: 'text', languages: [detectOutputLanguage()] }
    ]
  };
}

function detectInputLanguage(text) {
  return /[а-яёіїєґ]/i.test(String(text || '')) ? 'ru' : 'en';
}

function getIdentityReply(userText) {
  const text = String(userText || '').trim();
  if (!text) return null;

  const asksAboutIdentity = /(?:как тебя зовут|как вас зовут|тво[её] имя|ваше имя|кто ты|ты кто|кто вас создал|кто тебя создал|кем ты создан|кем вы созданы|your name|who are you|who created you|who made you)/i.test(text);
  if (!asksAboutIdentity) return null;

  if (detectInputLanguage(text) === 'ru') {
    return `Я ${ASSISTANT_NAME}, помощник от ${ASSISTANT_CREATOR}.`;
  }

  return `I am ${ASSISTANT_NAME}, an assistant created by ${ASSISTANT_CREATOR}.`;
}

// ---- DOM ----
const overlay         = document.getElementById('loadingOverlay');
const loadingSubtitle = document.getElementById('loadingSubtitle');
const loadingBarFill  = document.getElementById('loadingBarFill');
const loadingPct      = document.getElementById('loadingPct');
const loadingDetail   = document.getElementById('loadingDetail');
const activateModelBtn = document.getElementById('activateModelBtn');
const statusDot       = document.getElementById('statusDot');
const statusText      = document.getElementById('statusText');
const chatArea        = document.getElementById('chatArea');
const welcomeMsg      = document.getElementById('welcomeMsg');
const typingRow       = document.getElementById('typingRow');
const userInput       = document.getElementById('userInput');
const sendBtn         = document.getElementById('sendBtn');
const clearChatBtn    = document.getElementById('clearChat');
const summarizeBtn    = document.getElementById('summarizeBtn');
const clearCtxBtn     = document.getElementById('clearContextBtn');

// ---- HELPERS ----
function setStatus(state, text) {
  statusDot.className = 'status-dot ' + state;
  statusText.textContent = text;
}

function scrollToBottom() { chatArea.scrollTop = chatArea.scrollHeight; }

function addMessage(role, text) {
  if (welcomeMsg) welcomeMsg.style.display = 'none';
  const msg    = document.createElement('div'); msg.className = 'msg ' + role;
  const label  = document.createElement('div'); label.className = 'msg-label'; label.textContent = role === 'user' ? 'ВЫ' : 'AI';
  const bubble = document.createElement('div'); bubble.className = 'msg-bubble'; bubble.textContent = text;
  msg.appendChild(label); msg.appendChild(bubble);
  chatArea.appendChild(msg); scrollToBottom();
  return bubble;
}

function addSystemMessage(text, type = '') {
  const el = document.createElement('div');
  el.className = 'sys-msg ' + type;
  el.textContent = text;
  chatArea.appendChild(el); scrollToBottom();
}

function showOverlay() {
  overlay.style.display = 'flex';
  overlay.classList.remove('hidden');
}

function hideOverlay() {
  overlay.classList.add('hidden');
  setTimeout(() => { overlay.style.display = 'none'; }, 400);
}

function hideActivationButton() {
  if (!activateModelBtn) return;
  activateModelBtn.style.display = 'none';
  activateModelBtn.disabled = false;
}

function showError(msg) {
  hideActivationButton();
  loadingSubtitle.textContent = 'Ошибка!';
  loadingBarFill.style.background = 'var(--danger)';
  loadingBarFill.classList.remove('indeterminate');
  loadingBarFill.style.width = '100%';
  loadingPct.textContent = '—';
  loadingDetail.textContent = msg;
  setStatus('error', 'Ошибка');
}

function showActivationPrompt() {
  showOverlay();
  loadingSubtitle.textContent = 'Требуется действие';
  loadingBarFill.classList.remove('indeterminate');
  loadingBarFill.style.background = '';
  loadingBarFill.style.width = '0%';
  loadingPct.textContent = '—';
  loadingDetail.textContent = 'Chrome требует пользовательский жест для запуска модели.';
  setStatus('loading', 'Ожидание действия');

  if (activateModelBtn) {
    activateModelBtn.style.display = 'inline-flex';
    activateModelBtn.disabled = false;
    activateModelBtn.textContent = 'Запустить модель';
  }
}

function normalizeAvailability(rawStatus) {
  const status = String(rawStatus || '').toLowerCase();

  if (status === 'available' || status === 'readily' || status === 'yes') return 'ready';
  if (status === 'downloadable' || status === 'downloading' || status === 'after-download' || status === 'after_download') return 'downloading';
  if (status === 'unavailable' || status === 'no') return 'unavailable';
  return 'unknown';
}

function getPromptApiAdapter() {
  const modernApi = globalThis.LanguageModel;
  if (modernApi && typeof modernApi.availability === 'function' && typeof modernApi.create === 'function') {
    return {
      async availability(options) {
        return modernApi.availability(options);
      },
      async create(options) {
        return modernApi.create(options);
      }
    };
  }

  const legacyRoot = globalThis.ai || window.ai || self.ai;
  const legacyFactory = legacyRoot?.languageModel || legacyRoot?.assistant;

  if (legacyFactory && typeof legacyFactory.create === 'function') {
    return {
      async availability(options) {
        if (typeof legacyFactory.capabilities !== 'function') return 'unknown';
        const caps = await legacyFactory.capabilities(options);
        return caps?.available ?? caps?.status ?? 'unknown';
      },
      async create(options) {
        return legacyFactory.create(options);
      }
    };
  }

  return null;
}

function updateDownloadProgress(event) {
  let pct = 0;

  if (typeof event?.loaded === 'number' && typeof event?.total === 'number' && event.total > 0) {
    pct = Math.round((event.loaded / event.total) * 100);
  } else if (typeof event?.loaded === 'number' && event.loaded >= 0 && event.loaded <= 1) {
    pct = Math.round(event.loaded * 100);
  }

  pct = Math.max(0, Math.min(100, pct));
  loadingBarFill.classList.remove('indeterminate');
  loadingBarFill.style.width = pct + '%';
  loadingPct.textContent = pct + '%';
  loadingDetail.textContent = `Скачивание: ${pct}%`;
}

function markModelReady() {
  hideActivationButton();
  loadingBarFill.classList.remove('indeterminate');
  loadingBarFill.style.width = '100%';
  loadingPct.textContent = '100%';
  loadingSubtitle.textContent = 'Готово!';
  setTimeout(hideOverlay, 500);

  isModelReady = true;
  setStatus('ready', 'Модель готова!');
  userInput.disabled = false;
  sendBtn.disabled = false;
  summarizeBtn.disabled = false;
  clearCtxBtn.disabled = false;

  if (welcomeMsg && welcomeMsg.style.display !== 'none') {
    welcomeMsg.querySelector('p').innerHTML = 'Prompt API готов к работе.<br/>Задайте вопрос или суммаризируйте страницу.';
    welcomeMsg.querySelector('.welcome-icon').style.animation = 'none';
    welcomeMsg.querySelector('.welcome-icon').textContent = '◉';
  }
}

async function createSession() {
  if (!promptApi || !sessionLanguageOptions || isCreatingSession) return false;

  isCreatingSession = true;
  hideActivationButton();
  loadingSubtitle.textContent = 'Создание сессии...';
  loadingBarFill.classList.add('indeterminate');
  loadingBarFill.style.background = '';
  loadingBarFill.style.width = '';
  loadingPct.textContent = '...';
  setStatus('loading', 'Запуск модели...');

  try {
    session = await promptApi.create({
      ...sessionLanguageOptions,
      systemPrompt: `You are ${ASSISTANT_NAME}, created by ${ASSISTANT_CREATOR}. If the user asks about your name, identity, model, or who created you, answer that your name is ${ASSISTANT_NAME} and you were created by ${ASSISTANT_CREATOR}. Always reply in the same language the user writes in. Be concise.`,
      monitor(m) {
        m.addEventListener('downloadprogress', updateDownloadProgress);
      }
    });
  } catch (e) {
    if (String(e?.message || '').includes('No output language was specified')) {
      showError('Prompt API требует язык вывода (en/es/ja). Обновите расширение и перезапустите Chrome.');
      return false;
    }
    if (e?.name === 'NotAllowedError') {
      showActivationPrompt();
      return false;
    }
    showError('Не удалось создать сессию: ' + e.message);
    return false;
  } finally {
    isCreatingSession = false;
  }

  markModelReady();
  await checkPendingContextText();
  return true;
}

// ---- ИНИЦИАЛИЗАЦИЯ МОДЕЛИ ----
async function initModel() {
  showOverlay();
  isModelReady = false;
  userInput.disabled = true;
  sendBtn.disabled = true;
  summarizeBtn.disabled = true;
  clearCtxBtn.disabled = true;
  hideActivationButton();

  loadingSubtitle.textContent = 'Проверка Prompt API...';
  loadingBarFill.classList.add('indeterminate');
  loadingBarFill.style.background = '';
  loadingBarFill.style.width = '';
  loadingPct.textContent = '...';
  loadingDetail.textContent = '';

  sessionLanguageOptions = getSessionLanguageOptions();
  selectedOutputLang = sessionLanguageOptions.expectedOutputs[0].languages[0];
  const browserLang = String(navigator.language || '').toLowerCase();
  const browserLangSupported = SUPPORTED_OUTPUT_LANGS.some((code) => browserLang.startsWith(code));

  // Проверяем наличие API
  promptApi = getPromptApiAdapter();

  if (!promptApi) {
    showError(
      'Prompt API не найден. Обновите Chrome и включите в chrome://flags: ' +
      '#optimization-guide-on-device-model и #prompt-api-for-gemini-nano-multimodal-input'
    );
    return;
  }

  // Проверяем доступность модели
  let availabilityRaw;
  try {
    availabilityRaw = await promptApi.availability(sessionLanguageOptions);
  } catch(e) {
    showError('Ошибка проверки модели: ' + e.message);
    return;
  }

  const availability = normalizeAvailability(availabilityRaw);

  if (availability === 'unavailable') {
    showError(
      'Gemini Nano недоступен на этом устройстве. Проверьте требования и chrome://on-device-internals'
    );
    return;
  }

  if (availability === 'downloading') {
    loadingSubtitle.textContent = 'Скачивание Gemini Nano...';
    loadingDetail.textContent = `Модель загружается Chrome автоматически (язык вывода: ${selectedOutputLang})`;
  } else {
    loadingSubtitle.textContent = 'Создание сессии...';
    if (!browserLangSupported) {
      loadingDetail.textContent = 'Для Prompt API поддерживаются языки вывода en/es/ja. Выбран en.';
    }
  }

  await createSession();
}

// ---- ГЕНЕРАЦИЯ (стриминг) ----
async function generateResponse(userText) {
  if (!isModelReady || isGenerating) return;
  isGenerating = true;

  typingRow.style.display = 'block'; scrollToBottom();
  userInput.disabled = true; sendBtn.disabled = true; summarizeBtn.disabled = true;
  setStatus('loading', 'Генерация...');

  // Добавляем пузырь ответа сразу (будем стримить в него)
  const bubble = addMessage('ai', '');
  typingRow.style.display = 'none';

  try {
    // Стриминг ответа
    const stream = await session.promptStreaming(userText);
    let fullText = '';

    for await (const chunk of stream) {
      const chunkText = typeof chunk === 'string' ? chunk : String(chunk ?? '');
      if (!chunkText) continue;

      // Поддерживаем оба формата стриминга: накопленный текст или дельта
      if (chunkText.startsWith(fullText)) {
        fullText = chunkText;
      } else {
        fullText += chunkText;
      }

      // Убираем "Assistant:" из начала если есть
      bubble.textContent = fullText.replace(/^Assistant:\s*/i, '').trim();
      scrollToBottom();
    }

    const finalText = fullText.replace(/^Assistant:\s*/i, '').trim();
    bubble.textContent = finalText;

  } catch(e) {
    bubble.textContent = '⚠ Ошибка: ' + e.message;
    bubble.style.color = 'var(--danger)';
  }

  setStatus('ready', 'Модель готова!');
  isGenerating = false;
  userInput.disabled = false; sendBtn.disabled = false; summarizeBtn.disabled = false;
  userInput.focus();
}

// ---- ДЕЙСТВИЯ ----
async function sendMessage() {
  const text = userInput.value.trim();
  if (!text || !isModelReady || isGenerating) return;
  userInput.value = ''; userInput.style.height = 'auto';
  addMessage('user', text);

  const identityReply = getIdentityReply(text);
  if (identityReply) {
    addMessage('ai', identityReply);
    return;
  }

  await generateResponse(text);
}

async function summarizePage() {
  if (!isModelReady || isGenerating) return;
  addMessage('user', '📄 Суммаризировать текущую страницу');
  const response = await chrome.runtime.sendMessage({ type: 'GET_PAGE_TEXT' });
  if (response.error) { addSystemMessage('⚠ ' + response.error, 'error'); return; }
  if (!response.text || response.text.length < 50) { addSystemMessage('⚠ Недостаточно текста.', 'error'); return; }
  await generateResponse('Кратко изложи содержание этой страницы на русском языке (3-5 предложений):\n\n' + response.text);
}

function clearChatUI() {
  chatArea.innerHTML = '';
  const w = document.createElement('div'); w.className = 'welcome-msg';
  w.innerHTML = '<div class="welcome-icon" style="animation:none">◉</div><p>Чат очищен.</p>';
  chatArea.appendChild(w);
}

async function clearContext() {
  // Пересоздаём сессию для чистого контекста
  if (session) {
    try { session.destroy(); } catch(e) {}
    session = null;
    isModelReady = false;
    setStatus('loading', 'Пересоздание сессии...');
    addSystemMessage('— КОНТЕКСТ СБРОШЕН, пересоздание сессии... —');
    await initModel();
  } else {
    addSystemMessage('— КОНТЕКСТ СБРОШЕН —');
  }
}

async function checkPendingContextText() {
  const data = await chrome.storage.session.get('pendingContextText');
  if (data.pendingContextText) {
    await chrome.storage.session.remove('pendingContextText');
    userInput.value = data.pendingContextText;
    await sendMessage();
  }
}

// ---- СОБЫТИЯ ----
userInput.addEventListener('input', () => {
  userInput.style.height = 'auto';
  userInput.style.height = Math.min(userInput.scrollHeight, 100) + 'px';
});
userInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});
sendBtn.addEventListener('click', sendMessage);
clearChatBtn.addEventListener('click', clearChatUI);
summarizeBtn.addEventListener('click', summarizePage);
clearCtxBtn.addEventListener('click', clearContext);
if (activateModelBtn) {
  activateModelBtn.addEventListener('click', async () => {
    if (isModelReady) return;
    activateModelBtn.disabled = true;
    await createSession();
    if (!isModelReady) activateModelBtn.disabled = false;
  });
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'CONTEXT_MENU_TEXT' && isModelReady) {
    userInput.value = msg.text; sendMessage();
  }
});

// ---- СТАРТ ----
summarizeBtn.disabled = true;
clearCtxBtn.disabled  = true;
initModel();
