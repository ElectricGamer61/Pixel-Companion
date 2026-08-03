import './styles.css';

import { DAY_LABELS, normalizeDays } from '../shared/checkins';
import { DEFAULT_SETTINGS } from '../shared/defaults';
import { homeLine, openingLine, respond, systemPrompt } from '../shared/responder';
import type {
  AppSettings,
  CheckInEvent,
  CheckInTopic,
  CompanionMood,
  CompanionReply,
  PlacementEvent,
} from '../shared/types';
import { beginDrag, isClick, trackDrag, type DragGesture } from '../shared/window-position';
import { bridge, isDesktop } from './bridge';
import { Character } from './character';
import { SpeechInput, SpeechOutput } from './speech';

/** Idle time before the companion dozes off. */
const SLEEP_AFTER_MS = 5 * 60_000;
/** How long a reply-specific mood (happy, thinking) sticks before settling. */
const MOOD_HOLD_MS = 2600;
/** How long the greeting pose and its little home line stay up. */
const GREET_MS = 2400;
/** How long the home line lingers after the pointer leaves. */
const PEEK_LINGER_MS = 900;
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
  panelSettings: element<HTMLButtonElement>('panel-settings'),
  chatView: element('chat-view'),
  settingsView: element('settings-view'),
  log: element('log'),
  status: element('status'),
  composer: element<HTMLFormElement>('composer'),
  input: element<HTMLInputElement>('input'),
  mic: element<HTMLButtonElement>('mic'),
  bubble: element('bubble'),
  peek: element('peek'),
  character: element('character'),
  sprite: element<HTMLCanvasElement>('sprite'),
  zzz: element('zzz'),
  quit: element<HTMLButtonElement>('quit'),
  panelQuit: element<HTMLButtonElement>('panel-quit'),
  dataDir: element('data-dir'),
  voiceHint: element('voice-hint'),
  voiceEngineHint: element('voice-engine-hint'),
  checkInSlots: element('checkin-slots'),
  gymDays: element('gym-days'),
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
/**
 * Whether the companion is tucked in its corner. The main process owns the real
 * window, so this only ever changes on a placement event from it.
 */
let atHome = false;
let hovering = false;
/** Rotates the little home lines so the same one is not always on show. */
let peekTurn = 0;
/**
 * The buddy check-in the companion asked most recently, so a bare "yeah" or
 * "not today" is read as an answer to it. In memory for one reply only, and
 * never persisted — it is part of the conversation, and conversations are not
 * written to disk.
 *
 * It also expires: the question has to still be on screen for a bare "yeah" to
 * be an answer to it, so the topic dies with the bubble that carried it and, as
 * a backstop for the panel, after `TOPIC_TTL_MS`.
 */
const TOPIC_TTL_MS = 10 * 60_000;
let openTopic: CheckInTopic | null = null;
let openTopicUntil = 0;

function setOpenTopic(topic: CheckInTopic | null): void {
  openTopic = topic;
  openTopicUntil = topic ? Date.now() + TOPIC_TTL_MS : 0;
}

/** The check-in still awaiting an answer, or undefined once it has gone stale. */
function currentTopic(): CheckInTopic | undefined {
  if (openTopic && Date.now() > openTopicUntil) setOpenTopic(null);
  return openTopic ?? undefined;
}

/* ------------------------------------------------------------- mood ----- */

/**
 * The mood the companion falls back to when nothing else is happening.
 *
 * At home the companion is half below the screen edge, so it wears the raised
 * "peek" faces there: an ordinary face would be drawn off screen and leave a
 * blank dome sticking out of the desktop.
 */
function restingMood(): CompanionMood {
  const asleep = Date.now() - lastInteractionAt > SLEEP_AFTER_MS;
  if (panelOpen) return asleep ? 'sleeping' : 'listening';
  if (atHome) return asleep ? 'dozing' : 'peeking';
  return asleep ? 'sleeping' : 'idle';
}

/** The lively version of a mood, picked to suit where the companion is sitting. */
function livelyMood(): CompanionMood {
  return atHome && !panelOpen ? 'greeting' : 'happy';
}

function settleMood(): void {
  if (Date.now() < moodHoldUntil) return;
  applyMood(restingMood());
}

function applyMood(mood: CompanionMood): void {
  character.setMood(mood);
  // Mirrored onto the element so the current pose is visible from the DOM: the
  // sprite is a canvas, and this is the only way to see it from the outside
  // when driving the app over the debugging protocol.
  dom.character.dataset.mood = mood;
  dom.zzz.hidden = mood !== 'sleeping' && mood !== 'dozing';
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

document.addEventListener('mousemove', (event) => {
  if (drag) return;
  const target = document.elementFromPoint(event.clientX, event.clientY);
  void setInteractive(Boolean(target?.closest('[data-interactive]')));
  // Hover comes off the same hit test as click-through: the window is inert
  // most of the time, so element-level mouseenter is not dependable, but these
  // forwarded moves always arrive.
  setHovering(Boolean(target?.closest('#character')));
});

document.addEventListener('mouseleave', () => {
  if (drag) return;
  void setInteractive(false);
  setHovering(false);
});

/* ------------------------------------------------------------- dragging - */

/**
 * The gesture in flight, or `null` when the pointer is not down on the
 * character. Drag moves the window and nothing else: no scale, no size, no
 * panel state. The window is a fixed-size overlay and the main process
 * re-states that size on every move.
 */
let drag: DragGesture | null = null;
/** Whether the current gesture has already struck its carried-around pose. */
let dragPosed = false;

function releaseDrag(pointerId: number): void {
  if (dom.character.hasPointerCapture(pointerId)) {
    dom.character.releasePointerCapture(pointerId);
  }
}

dom.character.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  drag = beginDrag(event.screenX, event.screenY);
  dragPosed = false;
  dom.character.setPointerCapture(event.pointerId);
  void bridge.startDrag();
});

dom.character.addEventListener('pointermove', (event) => {
  if (!drag) return;
  // Total travel since the press, never an increment: see `trackDrag`.
  const offset = trackDrag(drag, event.screenX, event.screenY);
  if (!offset) return;
  void bridge.dragWindowTo(offset.x, offset.y);
  // Being carried is the most alive the companion ever looks. The pose is set
  // once, when the gesture first crosses the drag threshold, and held until the
  // pointer comes up.
  if (!dragPosed) {
    dragPosed = true;
    markInteraction();
    hidePeek();
    holdMood(livelyMood(), 60_000);
  }
});

dom.character.addEventListener('pointerup', (event) => {
  if (!drag) return;
  const gesture = drag;
  drag = null;
  releaseDrag(event.pointerId);
  void bridge.endDrag();
  // A drag has already done its job; only a genuine click opens the panel.
  if (isClick(gesture)) {
    togglePanel();
    return;
  }
  // Set down: drop the carried pose and let the placement the main process
  // reports decide whether the companion is peeking again.
  dragPosed = false;
  moodHoldUntil = 0;
  settleMood();
});

// A cancelled gesture (the window manager grabbing the pointer mid-drag, say)
// must still settle the window, and must never fall through to a panel toggle.
dom.character.addEventListener('pointercancel', (event) => {
  if (!drag) return;
  drag = null;
  dragPosed = false;
  releaseDrag(event.pointerId);
  void bridge.endDrag();
  moodHoldUntil = 0;
  settleMood();
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

/* ------------------------------------------------------------ at home --- */

let peekTimer: number | null = null;

/**
 * Show the little home line above the companion's head.
 *
 * It is two or three words, it never asks anything, and it goes away on its
 * own: at home the companion is meant to be furniture with a pulse, not a
 * notification. It is also pointer-transparent, so it can never swallow a click
 * meant for the desktop underneath.
 */
function showPeek(ms: number): void {
  // A check-in bubble is the louder message and sits in the same column; the
  // home line never competes with it.
  if (!atHome || panelOpen || !dom.bubble.hidden) return;
  dom.peek.textContent = homeLine(peekTurn);
  dom.peek.hidden = false;
  if (peekTimer !== null) window.clearTimeout(peekTimer);
  peekTimer = window.setTimeout(() => {
    dom.peek.hidden = true;
  }, ms);
}

function hidePeek(): void {
  if (peekTimer !== null) window.clearTimeout(peekTimer);
  dom.peek.hidden = true;
}

/** A greeting pose plus one short line: the reply to being noticed. */
function greet(): void {
  peekTurn += 1;
  markInteraction();
  holdMood(livelyMood(), GREET_MS);
  showPeek(GREET_MS);
}

function setHovering(next: boolean): void {
  if (next === hovering) return;
  hovering = next;
  if (drag || panelOpen) return;
  if (next) {
    greet();
  } else if (!dom.peek.hidden) {
    // Let the line linger for a beat rather than snapping away with the pointer.
    showPeek(PEEK_LINGER_MS);
  }
}

/**
 * The main process is the only thing that knows where the window ended up, so
 * arriving home (or being dragged out of it) is what drives the home pose.
 */
function onPlacement(event: PlacementEvent): void {
  if (event.home === atHome) return;
  atHome = event.home;
  if (atHome) {
    // Tucked back in: pop up once so "return to corner" has a visible reply.
    greet();
  } else {
    hidePeek();
    moodHoldUntil = 0;
  }
  settleMood();
}

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

function context(): {
  companionName: string;
  userName: string;
  turn: number;
  hour: number;
  topic?: CheckInTopic;
} {
  return {
    companionName: settings.companionName,
    userName: settings.userName,
    turn,
    hour: new Date().getHours(),
    topic: currentTopic(),
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
  // The check-in has been answered; the next message is its own message again.
  setOpenTopic(null);
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
    hidePeek();
    // Opening the companion always lands on the conversation, whatever was on
    // screen when it was last closed.
    showSettings(false);
    if (!greeted) {
      greeted = true;
      appendMessage(openingLine(context()), 'them');
      // Said once, in plain words: what this thing will actually do to you, and
      // where to change it. Otherwise the first check-in arrives unannounced.
      appendMessage(buddyIntro(), 'system');
    }
    window.setTimeout(() => dom.input.focus(), 0);
  } else {
    // Closing tucks the companion back into the corner; the home line is how
    // that reads as "still here" rather than "gone".
    showPeek(GREET_MS);
  }
  moodHoldUntil = 0;
  settleMood();
}

/** The one-line description of what the companion will ask about, unprompted. */
function buddyIntro(): string {
  const { checkIns } = settings;
  if (!checkIns.enabled) return 'Check-ins are off, so I will only talk when you talk to me.';
  const asks: string[] = [];
  if (checkIns.gymEnabled) asks.push('whether you got moving');
  if (checkIns.lifeEnabled) asks.push('what you did with your day');
  if (asks.length === 0) return 'I will check in on you now and then. Settings decides when.';
  return `I will check in and ask ${asks.join(' and ')}. Change that any time in settings.`;
}

function togglePanel(): void {
  setPanelOpen(!panelOpen);
}

dom.panelClose.addEventListener('click', () => setPanelOpen(false));
dom.panelHome.addEventListener('click', () => returnHome());
dom.homeCorner.addEventListener('click', () => returnHome());

let settingsOpen = false;

/** Settings is a drawer over the conversation, not a second app screen. */
function showSettings(open: boolean): void {
  settingsOpen = open;
  dom.chatView.hidden = open;
  dom.settingsView.hidden = !open;
  dom.panelSettings.classList.toggle('is-active', open);
  dom.panelSettings.setAttribute('aria-pressed', String(open));
  const label = open ? 'Back to the conversation' : 'Settings';
  dom.panelSettings.setAttribute('aria-label', label);
  dom.panelSettings.title = label;
  if (!open) window.setTimeout(() => dom.input.focus(), 0);
}

dom.panelSettings.addEventListener('click', () => showSettings(!settingsOpen));

document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !panelOpen) return;
  // Escape backs out one step at a time: settings first, then the panel.
  if (settingsOpen) showSettings(false);
  else setPanelOpen(false);
});

/* --------------------------------------------------------------- bubble - */

let bubbleTimer: number | null = null;

function hideBubble(): void {
  dom.bubble.hidden = true;
  if (bubbleTimer !== null) {
    window.clearTimeout(bubbleTimer);
    bubbleTimer = null;
  }
}

function showBubble(text: string, ms = 22_000): void {
  hidePeek();
  dom.bubble.textContent = text;
  dom.bubble.hidden = false;
  if (bubbleTimer !== null) window.clearTimeout(bubbleTimer);
  bubbleTimer = window.setTimeout(() => {
    bubbleTimer = null;
    dom.bubble.hidden = true;
    // The question has gone off screen unanswered, so there is nothing left for
    // a bare "yeah" hours later to be an answer to.
    setOpenTopic(null);
  }, ms);
}

dom.bubble.addEventListener('click', () => {
  const text = dom.bubble.textContent ?? '';
  // Cancel the auto-hide: the question moves into the panel, so it is still the
  // thing being answered.
  hideBubble();
  setPanelOpen(true);
  if (text) {
    appendMessage(text, 'them');
    history.push({ role: 'assistant', content: text });
  }
});

function onCheckIn(event: CheckInEvent): void {
  markInteraction();
  // A gym or life check-in is a question with a yes/no shape, so remember which
  // one was asked: it is the difference between "nope" landing as an answer and
  // landing as nothing at all.
  setOpenTopic(event.kind === 'gym' || event.kind === 'life' ? event.kind : null);
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
  gymEnabled: element<HTMLInputElement>('set-gym-enabled'),
  gymTime: element<HTMLInputElement>('set-gym-time'),
  lifeEnabled: element<HTMLInputElement>('set-life-enabled'),
  lifeTime: element<HTMLInputElement>('set-life-time'),
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
  modelKey: element<HTMLInputElement>('set-model-key'),
  modelTimeout: element<HTMLInputElement>('set-model-timeout'),
};

/** The wait before falling back, shown in whole seconds rather than in ms. */
const MODEL_TIMEOUT_STEP_MS = 1000;

/**
 * The gym day picker, built from the shared day labels so the buttons can never
 * drift out of step with how `gymDays` is stored.
 */
const dayChips: HTMLButtonElement[] = [];

function buildDayChips(): void {
  dom.gymDays.replaceChildren();
  dayChips.length = 0;
  DAY_LABELS.forEach((label, index) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'day';
    chip.textContent = label.slice(0, 1);
    chip.title = label;
    chip.setAttribute('aria-label', label);
    chip.setAttribute('aria-pressed', 'false');
    chip.addEventListener('click', () => {
      const on = chip.getAttribute('aria-pressed') !== 'true';
      chip.setAttribute('aria-pressed', String(on));
      chip.classList.toggle('is-on', on);
      // Clearing the last day is how someone says "stop asking me about the
      // gym", so say it out loud on the toggle instead of quietly refilling
      // the week behind their back.
      if (selectedDays() === '') fields.gymEnabled.checked = false;
      void persist();
    });
    dom.gymDays.append(chip);
    dayChips[index] = chip;
  });
}

/** Read the chips back into the stored `0`-`6` string. */
function selectedDays(): string {
  return normalizeDays(
    dayChips
      .map((chip, index) => (chip.getAttribute('aria-pressed') === 'true' ? String(index) : ''))
      .join(''),
  );
}

function fillSettingsForm(): void {
  fields.userName.value = settings.userName;
  fields.companionName.value = settings.companionName;
  fields.checkInsEnabled.checked = settings.checkIns.enabled;
  fields.morningEnabled.checked = settings.checkIns.morningEnabled;
  fields.morningTime.value = settings.checkIns.morningTime;
  fields.eveningEnabled.checked = settings.checkIns.eveningEnabled;
  fields.eveningTime.value = settings.checkIns.eveningTime;
  fields.gymEnabled.checked = settings.checkIns.gymEnabled;
  fields.gymTime.value = settings.checkIns.gymTime;
  fields.lifeEnabled.checked = settings.checkIns.lifeEnabled;
  fields.lifeTime.value = settings.checkIns.lifeTime;
  dayChips.forEach((chip, index) => {
    const on = settings.checkIns.gymDays.includes(String(index));
    chip.setAttribute('aria-pressed', String(on));
    chip.classList.toggle('is-on', on);
  });
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
  fields.modelKey.value = settings.model.apiKey;
  fields.modelTimeout.value = String(Math.round(settings.model.timeoutMs / MODEL_TIMEOUT_STEP_MS));
}

async function persist(): Promise<void> {
  const minutes = Number(fields.intervalMinutes.value);
  const rawSeconds = Number(fields.modelTimeout.value);
  const timeoutSeconds =
    Number.isFinite(rawSeconds) && rawSeconds >= 1 ? Math.round(rawSeconds) : NaN;
  const gymDays = selectedDays();
  settings = await bridge.saveSettings({
    userName: fields.userName.value.trim(),
    companionName: fields.companionName.value.trim() || 'Pip',
    scale: Number(fields.scale.value),
    alwaysOnTop: fields.alwaysOnTop.checked,
    checkIns: {
      enabled: fields.checkInsEnabled.checked,
      morningEnabled: fields.morningEnabled.checked,
      // A cleared time field falls back to the shipped default rather than a
      // literal, so the two can never drift apart.
      morningTime: fields.morningTime.value || DEFAULT_SETTINGS.checkIns.morningTime,
      eveningEnabled: fields.eveningEnabled.checked,
      eveningTime: fields.eveningTime.value || DEFAULT_SETTINGS.checkIns.eveningTime,
      gymEnabled: fields.gymEnabled.checked,
      gymTime: fields.gymTime.value || DEFAULT_SETTINGS.checkIns.gymTime,
      gymDays,
      lifeEnabled: fields.lifeEnabled.checked,
      lifeTime: fields.lifeTime.value || DEFAULT_SETTINGS.checkIns.lifeTime,
      intervalEnabled: fields.intervalEnabled.checked,
      intervalMinutes:
        Number.isFinite(minutes) && minutes >= 5
          ? Math.round(minutes)
          : DEFAULT_SETTINGS.checkIns.intervalMinutes,
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
      apiKey: fields.modelKey.value.trim(),
      // Shown in seconds, stored in milliseconds. A cleared or nonsense box
      // falls back to the shipped default rather than to zero, which would make
      // every model reply time out instantly.
      timeoutMs: Number.isFinite(timeoutSeconds)
        ? timeoutSeconds * MODEL_TIMEOUT_STEP_MS
        : DEFAULT_SETTINGS.model.timeoutMs,
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
  // One master switch that visibly owns the rows under it, so "check-ins are
  // off" never has to be worked out by reading five separate toggles.
  dom.checkInSlots.classList.toggle('is-off', !settings.checkIns.enabled);
  for (const node of dom.checkInSlots.querySelectorAll('input, button')) {
    (node as HTMLInputElement | HTMLButtonElement).disabled = !settings.checkIns.enabled;
  }
}

function updateMicVisibility(): void {
  const usable = settings.voice.micEnabled && SpeechInput.supported;
  dom.mic.hidden = !settings.voice.micEnabled;
  dom.mic.disabled = !usable;
  dom.mic.title = usable
    ? 'Hold a thought and speak'
    : 'Talking out loud is not available here. Type to me instead.';
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

  // Two hints, deliberately split. The one people see says only what they can
  // act on; the one that names the machinery underneath is folded away in
  // Advanced, where a technical answer is what someone came looking for.
  const canSpeak = speechOut.engine !== 'none';
  // A switch that cannot do anything is worse than no switch: on a machine with
  // no voice at all, say so in the hint and leave the toggle inert.
  fields.speakReplies.disabled = !canSpeak;
  fields.voiceRate.disabled = !canSpeak;
  const plain = canSpeak
    ? 'I can talk out loud on this computer. It costs nothing and works offline.'
    : 'This computer has no voice installed, so I will reply in writing.';
  const micNote = SpeechInput.supported
    ? ' You can talk to me with the microphone button, or just type.'
    : ' The microphone is not available here, so typing is the way to talk to me.';
  dom.voiceHint.textContent = plain + micNote;

  const engineHints: Record<'web' | 'native' | 'none', string> = {
    web: 'Speaking uses the voices built into your browser or system. Free, offline, no account.',
    native:
      'Speaking uses your operating system speech command (say, PowerShell SAPI, spd-say, or espeak-ng). Free and offline.',
    none: 'No speech program was found. On Linux, installing speech-dispatcher or espeak-ng turns spoken replies on.',
  };
  dom.voiceEngineHint.textContent = engineHints[speechOut.engine];
}

async function boot(): Promise<void> {
  settings = await bridge.getSettings();
  buildDayChips();
  applySettings();
  showSettings(false);
  character.start();
  applyMood('idle');

  dom.dataDir.textContent = await bridge.dataDirectory();

  bridge.onCheckIn(onCheckIn);
  // Listen before asking, so a move that happens mid-boot cannot slip through
  // the gap between the two.
  bridge.onPlacement(onPlacement);
  onPlacement(await bridge.getPlacement());

  await speechOut.init();
  populateVoices();
  updateMicVisibility();

  if (!isDesktop) {
    appendMessage(
      'Preview mode: this is the companion in a browser tab, so moving me around the desktop and timed check-ins only happen in the real app.',
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
