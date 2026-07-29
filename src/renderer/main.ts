import './styles.css';

import { openingLine, respond, systemPrompt } from '../shared/responder';
import type { AppSettings, CheckInEvent, CompanionMood, CompanionReply } from '../shared/types';
import { beginDrag, isClick, trackDrag, type DragGesture } from '../shared/window-position';
import { bridge, isDesktop } from './bridge';
import { Character } from './character';
import { SpeechInput, SpeechOutput } from './speech';

/** Idle time before the companion dozes off. */
const SLEEP_AFTER_MS = 5 * 60_000;
/** How long a reply-specific mood (happy, thinking) sticks before settling. */
const MOOD_HOLD_MS = 2600;
/** Conversation turns kept in memory for the optional local model. */
const HISTORY_LIMIT = 12;

function element<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing element #${id}`);
  return node as T;
}

const dom = {
  app: element('app'),
  panel: element('panel'),
  panelTitle: element('panel-title'),
  panelClose: element<HTMLButtonElement>('panel-close'),
  panelHome: element<HTMLButtonElement>('panel-home'),
  homeCorner: element<HTMLButtonElement>('home-corner'),
  tabChat: element<HTMLButtonElement>('tab-chat'),
  tabSettings: element<HTMLButtonElement>('tab-settings'),
  chatView: element('chat-view'),
  settingsView: element('settings-view'),
  log: element('log'),
  status: element('status'),
  composer: element<HTMLFormElement>('composer'),
  input: element<HTMLInputElement>('input'),
  mic: element<HTMLButtonElement>('mic'),
  bubble: element('bubble'),
  character: element('character'),
  sprite: element<HTMLCanvasElement>('sprite'),
  zzz: element('zzz'),
  quit: element<HTMLButtonElement>('quit'),
  panelQuit: element<HTMLButtonElement>('panel-quit'),
  dataDir: element('data-dir'),
  voiceHint: element('voice-hint'),
};

const character = new Character(dom.sprite);
const speechOut = new SpeechOutput();
const speechIn = new SpeechInput();

let settings: AppSettings;
let panelOpen = false;
let turn = 0;
let lastInteractionAt = Date.now();
let moodHoldUntil = 0;
let interactive = false;
let history: { role: string; content: string }[] = [];
let greeted = false;
let pendingReply = false;

/* ------------------------------------------------------------- mood ----- */

/** The mood the companion falls back to when nothing else is happening. */
function restingMood(): CompanionMood {
  if (Date.now() - lastInteractionAt > SLEEP_AFTER_MS) return 'sleeping';
  if (panelOpen) return 'listening';
  return 'idle';
}

function settleMood(): void {
  if (Date.now() < moodHoldUntil) return;
  applyMood(restingMood());
}

function applyMood(mood: CompanionMood): void {
  character.setMood(mood);
  dom.zzz.hidden = mood !== 'sleeping';
}

/** Show a mood for a beat, then let it settle back. */
function holdMood(mood: CompanionMood, ms = MOOD_HOLD_MS): void {
  applyMood(mood);
  moodHoldUntil = Date.now() + ms;
}

function markInteraction(): void {
  lastInteractionAt = Date.now();
}

/* ------------------------------------------------------- click-through -- */

/**
 * The window covers a rectangle of desktop, but only the character and panel
 * should catch the mouse. On every pointer move we hit-test and flip Electron's
 * click-through accordingly, so the desktop underneath stays usable.
 */
async function setInteractive(next: boolean): Promise<void> {
  if (next === interactive) return;
  interactive = next;
  await bridge.setInteractive(next);
}

function hitTest(x: number, y: number): boolean {
  const target = document.elementFromPoint(x, y);
  return Boolean(target?.closest('[data-interactive]'));
}

document.addEventListener('mousemove', (event) => {
  if (drag) return;
  void setInteractive(hitTest(event.clientX, event.clientY));
});

document.addEventListener('mouseleave', () => {
  if (!drag) void setInteractive(false);
});

/* ------------------------------------------------------------- dragging - */

/**
 * The gesture in flight, or `null` when the pointer is not down on the
 * character. Drag moves the window and nothing else: no scale, no size, no
 * panel state. The window is a fixed-size overlay and the main process
 * re-states that size on every move.
 */
let drag: DragGesture | null = null;

function releaseDrag(pointerId: number): void {
  if (dom.character.hasPointerCapture(pointerId)) {
    dom.character.releasePointerCapture(pointerId);
  }
}

dom.character.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = beginDrag(event.screenX, event.screenY);
  dom.character.setPointerCapture(event.pointerId);
  void bridge.startDrag();
});

dom.character.addEventListener('pointermove', (event) => {
  if (!drag) return;
  // Total travel since the press, never an increment: see `trackDrag`.
  const offset = trackDrag(drag, event.screenX, event.screenY);
  if (offset) void bridge.dragWindowTo(offset.x, offset.y);
});

dom.character.addEventListener('pointerup', (event) => {
  if (!drag) return;
  const gesture = drag;
  drag = null;
  releaseDrag(event.pointerId);
  void bridge.endDrag();
  // A drag has already done its job; only a genuine click opens the panel.
  if (isClick(gesture)) togglePanel();
});

// A cancelled gesture (the window manager grabbing the pointer mid-drag, say)
// must still settle the window, and must never fall through to a panel toggle.
dom.character.addEventListener('pointercancel', (event) => {
  if (!drag) return;
  drag = null;
  releaseDrag(event.pointerId);
  void bridge.endDrag();
});

/** Send the companion back to its bottom-right home. */
function returnHome(): void {
  markInteraction();
  void bridge.goHome();
}

// Right-clicking the character is the escape hatch when it has been dragged
// somewhere awkward and the panel is closed.
dom.character.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  returnHome();
});

/* ----------------------------------------------------------------- chat - */

/** URLs and bare domains we turn into real links inside a message. */
const LINK_PATTERN = /\b((?:https?:\/\/)?(?:findahelpline\.com|988lifeline\.org)\S*)/g;

function appendMessage(text: string, kind: 'them' | 'you' | 'system', safety = false): HTMLElement {
  const node = document.createElement('div');
  node.className = `msg msg--${kind}${safety ? ' msg--safety' : ''}`;

  let cursor = 0;
  for (const match of text.matchAll(LINK_PATTERN)) {
    const index = match.index ?? 0;
    node.append(text.slice(cursor, index));
    const link = document.createElement('a');
    link.href = '#';
    link.textContent = match[1];
    const url = match[1].startsWith('http') ? match[1] : `https://${match[1]}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      void bridge.openExternal(url);
    });
    node.append(link);
    cursor = index + match[1].length;
  }
  node.append(text.slice(cursor));

  dom.log.append(node);
  dom.log.scrollTop = dom.log.scrollHeight;
  return node;
}

function showTyping(): HTMLElement {
  const node = document.createElement('div');
  node.className = 'msg msg--them msg--typing';
  node.innerHTML = '<span>•</span><span>•</span><span>•</span>';
  dom.log.append(node);
  dom.log.scrollTop = dom.log.scrollHeight;
  return node;
}

function context(): { companionName: string; userName: string; turn: number; hour: number } {
  return {
    companionName: settings.companionName,
    userName: settings.userName,
    turn,
    hour: new Date().getHours(),
  };
}

async function speak(text: string): Promise<void> {
  if (!settings.voice.speakReplies || !speechOut.available) return;
  holdMood('talking', 60_000);
  try {
    await speechOut.speak(text, settings.voice);
  } finally {
    moodHoldUntil = 0;
    settleMood();
  }
}

async function deliver(reply: CompanionReply): Promise<void> {
  appendMessage(reply.text, 'them', reply.safety);
  history.push({ role: 'assistant', content: reply.text });
  history = history.slice(-HISTORY_LIMIT);
  holdMood(reply.mood);
  await speak(reply.text);
}

async function send(raw: string): Promise<void> {
  const text = raw.trim();
  if (!text || pendingReply) return;
  markInteraction();
  pendingReply = true;
  dom.input.value = '';
  appendMessage(text, 'you');
  history.push({ role: 'user', content: text });
  history = history.slice(-HISTORY_LIMIT);
  turn += 1;

  // The offline rules always run: they are the default engine, and their
  // safety classification takes priority over anything a model might say.
  const offline = respond(text, context());
  holdMood('thinking', 30_000);
  const typing = showTyping();

  let reply = offline;
  if (settings.model.enabled && !offline.safety) {
    const modelText = await bridge.askModel(systemPrompt(context()), history);
    if (modelText) reply = { text: modelText, mood: offline.mood, source: 'model' };
  } else {
    // A beat of "thinking" so replies do not snap back instantly.
    await new Promise((resolve) => setTimeout(resolve, 420));
  }

  typing.remove();
  moodHoldUntil = 0;
  pendingReply = false;
  await deliver(reply);
}

dom.composer.addEventListener('submit', (event) => {
  event.preventDefault();
  void send(dom.input.value);
});

dom.input.addEventListener('input', () => {
  markInteraction();
  if (!pendingReply) holdMood('listening', 1500);
});

/* ---------------------------------------------------------------- panel - */

function setPanelOpen(open: boolean): void {
  panelOpen = open;
  dom.panel.hidden = !open;
  // At rest the companion peeks out of the corner with half of itself off the
  // screen; the panel is window-wide, so the window has to come fully into view
  // for as long as it is open.
  void bridge.setPanelOpen(open);
  markInteraction();
  if (open) {
    dom.bubble.hidden = true;
    if (!greeted) {
      greeted = true;
      appendMessage(openingLine(context()), 'them');
    }
    window.setTimeout(() => dom.input.focus(), 0);
  }
  moodHoldUntil = 0;
  settleMood();
}

function togglePanel(): void {
  setPanelOpen(!panelOpen);
}

dom.panelClose.addEventListener('click', () => setPanelOpen(false));
dom.panelHome.addEventListener('click', () => returnHome());
dom.homeCorner.addEventListener('click', () => returnHome());

function showTab(tab: 'chat' | 'settings'): void {
  const chat = tab === 'chat';
  dom.chatView.hidden = !chat;
  dom.settingsView.hidden = chat;
  dom.tabChat.classList.toggle('is-active', chat);
  dom.tabSettings.classList.toggle('is-active', !chat);
  dom.tabChat.setAttribute('aria-pressed', String(chat));
  dom.tabSettings.setAttribute('aria-pressed', String(!chat));
}

dom.tabChat.addEventListener('click', () => showTab('chat'));
dom.tabSettings.addEventListener('click', () => showTab('settings'));

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && panelOpen) setPanelOpen(false);
});

/* --------------------------------------------------------------- bubble - */

let bubbleTimer: number | null = null;

function showBubble(text: string, ms = 22_000): void {
  dom.bubble.textContent = text;
  dom.bubble.hidden = false;
  if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    dom.bubble.hidden = true;
  }, ms);
}

dom.bubble.addEventListener('click', () => {
  const text = dom.bubble.textContent ?? '';
  dom.bubble.hidden = true;
  setPanelOpen(true);
  if (text) {
    appendMessage(text, 'them');
    history.push({ role: 'assistant', content: text });
  }
});

function onCheckIn(event: CheckInEvent): void {
  markInteraction();
  holdMood(event.kind === 'evening' ? 'listening' : 'happy');
  if (panelOpen) {
    appendMessage(event.message, 'them');
    history.push({ role: 'assistant', content: event.message });
  } else {
    showBubble(event.message);
  }
  void speak(event.message);
}

/* ------------------------------------------------------------------ mic - */

function setStatus(message: string): void {
  dom.status.textContent = message;
  dom.status.hidden = !message;
}

dom.mic.addEventListener('click', () => {
  markInteraction();
  if (speechIn.active) {
    speechIn.stop();
    return;
  }
  setStatus('');
  const started = speechIn.start({
    onPartial: (text) => {
      dom.input.value = text;
    },
    onFinal: (text) => {
      dom.input.value = text;
      void send(text);
    },
    onEnd: () => {
      dom.mic.classList.remove('is-listening');
      settleMood();
    },
    onError: (message) => setStatus(message),
  });
  if (started) {
    dom.mic.classList.add('is-listening');
    holdMood('listening', 30_000);
  }
});

/* ------------------------------------------------------------- settings - */

const fields = {
  userName: element<HTMLInputElement>('set-user-name'),
  companionName: element<HTMLInputElement>('set-companion-name'),
  checkInsEnabled: element<HTMLInputElement>('set-checkins-enabled'),
  morningEnabled: element<HTMLInputElement>('set-morning-enabled'),
  morningTime: element<HTMLInputElement>('set-morning-time'),
  eveningEnabled: element<HTMLInputElement>('set-evening-enabled'),
  eveningTime: element<HTMLInputElement>('set-evening-time'),
  intervalEnabled: element<HTMLInputElement>('set-interval-enabled'),
  intervalMinutes: element<HTMLInputElement>('set-interval-minutes'),
  speakReplies: element<HTMLInputElement>('set-speak-replies'),
  voiceName: element<HTMLSelectElement>('set-voice-name'),
  voiceRate: element<HTMLInputElement>('set-voice-rate'),
  micEnabled: element<HTMLInputElement>('set-mic-enabled'),
  scale: element<HTMLInputElement>('set-scale'),
  alwaysOnTop: element<HTMLInputElement>('set-always-on-top'),
  modelEnabled: element<HTMLInputElement>('set-model-enabled'),
  modelEndpoint: element<HTMLInputElement>('set-model-endpoint'),
  modelName: element<HTMLInputElement>('set-model-name'),
};

function fillSettingsForm(): void {
  fields.userName.value = settings.userName;
  fields.companionName.value = settings.companionName;
  fields.checkInsEnabled.checked = settings.checkIns.enabled;
  fields.morningEnabled.checked = settings.checkIns.morningEnabled;
  fields.morningTime.value = settings.checkIns.morningTime;
  fields.eveningEnabled.checked = settings.checkIns.eveningEnabled;
  fields.eveningTime.value = settings.checkIns.eveningTime;
  fields.intervalEnabled.checked = settings.checkIns.intervalEnabled;
  fields.intervalMinutes.value = String(settings.checkIns.intervalMinutes);
  fields.speakReplies.checked = settings.voice.speakReplies;
  fields.voiceRate.value = String(settings.voice.rate);
  fields.micEnabled.checked = settings.voice.micEnabled;
  fields.scale.value = String(settings.scale);
  fields.alwaysOnTop.checked = settings.alwaysOnTop;
  fields.modelEnabled.checked = settings.model.enabled;
  fields.modelEndpoint.value = settings.model.endpoint;
  fields.modelName.value = settings.model.model;
}

async function persist(): Promise<void> {
  const minutes = Number(fields.intervalMinutes.value);
  settings = await bridge.saveSettings({
    userName: fields.userName.value.trim(),
    companionName: fields.companionName.value.trim() || 'Pip',
    scale: Number(fields.scale.value),
    alwaysOnTop: fields.alwaysOnTop.checked,
    checkIns: {
      enabled: fields.checkInsEnabled.checked,
      morningEnabled: fields.morningEnabled.checked,
      morningTime: fields.morningTime.value || '09:00',
      eveningEnabled: fields.eveningEnabled.checked,
      eveningTime: fields.eveningTime.value || '21:00',
      intervalEnabled: fields.intervalEnabled.checked,
      intervalMinutes: Number.isFinite(minutes) && minutes >= 5 ? Math.round(minutes) : 120,
    },
    voice: {
      speakReplies: fields.speakReplies.checked,
      voiceName: fields.voiceName.value,
      rate: Number(fields.voiceRate.value),
      volume: settings.voice.volume,
      micEnabled: fields.micEnabled.checked,
    },
    model: {
      enabled: fields.modelEnabled.checked,
      endpoint: fields.modelEndpoint.value.trim(),
      model: fields.modelName.value.trim(),
      apiKey: settings.model.apiKey,
      timeoutMs: settings.model.timeoutMs,
    },
  });
  applySettings();
}

/** Push settings into the parts of the UI that reflect them. */
function applySettings(): void {
  dom.panelTitle.textContent = settings.companionName;
  character.setScale(settings.scale);
  updateMicVisibility();
  fillSettingsForm();
  fields.voiceName.value = settings.voice.voiceName;
}

function updateMicVisibility(): void {
  const usable = settings.voice.micEnabled && SpeechInput.supported;
  dom.mic.hidden = !settings.voice.micEnabled;
  dom.mic.disabled = !usable;
  dom.mic.title = usable
    ? 'Hold a thought and speak'
    : 'Speech recognition is not available in this build. Type instead.';
}

for (const field of Object.values(fields)) {
  field.addEventListener('change', () => void persist());
}

// Two ways out on purpose: the labelled button in Settings for anyone reading
// through it, and the header icon for anyone who just wants the companion gone.
dom.quit.addEventListener('click', () => void bridge.quit());
dom.panelQuit.addEventListener('click', () => void bridge.quit());

/* ------------------------------------------------------------- start-up - */

function populateVoices(): void {
  const voices = speechOut.listVoices();
  fields.voiceName.replaceChildren();

  const auto = document.createElement('option');
  auto.value = '';
  auto.textContent = voices.length > 0 ? 'System default' : 'System voice';
  fields.voiceName.append(auto);

  for (const name of voices) {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    fields.voiceName.append(option);
  }
  fields.voiceName.value = settings.voice.voiceName;
  fields.voiceName.disabled = voices.length === 0;

  const hints: Record<'web' | 'native' | 'none', string> = {
    web: 'Using your browser/OS speech voices. Free, offline, no account needed.',
    native:
      'Using your operating system speech command (say, PowerShell SAPI, spd-say, or espeak). Free and offline.',
    none: 'No speech engine was found. On Linux, install speech-dispatcher or espeak-ng to enable spoken replies.',
  };
  const micNote = SpeechInput.supported
    ? ' Microphone input is available.'
    : ' Microphone input is unavailable in this build, so typing is the input method.';
  dom.voiceHint.textContent = hints[speechOut.engine] + micNote;
}

async function boot(): Promise<void> {
  settings = await bridge.getSettings();
  applySettings();
  showTab('chat');
  character.start();
  applyMood('idle');

  dom.dataDir.textContent = await bridge.dataDirectory();

  bridge.onCheckIn(onCheckIn);

  await speechOut.init();
  populateVoices();
  updateMicVisibility();

  if (!isDesktop) {
    appendMessage(
      'Browser preview: the desktop window behaviours (always-on-top, drag, check-in scheduling) only run under Electron.',
      'system',
    );
  }

  // Settle the mood on a slow tick so the companion falls asleep when left
  // alone and wakes up on the next interaction.
  window.setInterval(settleMood, 1000);

  // Greet once on first launch so a new user sees the character do something.
  window.setTimeout(() => {
    if (!panelOpen && !greeted) showBubble(openingLine(context()), 12_000);
  }, 1500);
}

void boot().catch((error: unknown) => {
  console.error('[pixel-companion] failed to start', error);
});
