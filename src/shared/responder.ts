import type { CheckInTopic, CompanionMood, CompanionReply } from './types';

/**
 * The offline, rule-based responder.
 *
 * This is the default conversation engine and it never touches the network. It
 * is deliberately a *supportive listener*, not an advice engine: it reflects,
 * validates, and asks one open question. It makes no clinical or medical
 * claims, and it never diagnoses.
 */

export type Intent =
  | 'safety'
  | 'gratitude'
  | 'greeting'
  | 'farewell'
  | 'about'
  | 'capabilities'
  | 'positive'
  | 'self_critical'
  | 'anxious'
  | 'sad'
  | 'angry'
  | 'lonely'
  | 'tired'
  | 'overwhelmed'
  | 'exercise_done'
  | 'exercise_missed'
  | 'accountability'
  | 'affirmation'
  | 'unclear';

export interface ResponderContext {
  companionName: string;
  userName?: string;
  /** Monotonic conversation turn, used to rotate deterministically. */
  turn: number;
  /** Local hour 0-23, used only to pick a time-appropriate greeting. */
  hour?: number;
  /**
   * The buddy check-in the companion asked last, if the user is answering it.
   * Held in memory by the renderer for a single turn — never persisted — so a
   * bare "yeah" or "nope" gets an answer that knows what the question was.
   */
  topic?: CheckInTopic;
}

/**
 * Crisis phrasings. Kept intentionally specific so idioms like "this deadline
 * is killing me" or "I'm dying to go home" do not trip the safety path.
 */
const SAFETY_PATTERNS: RegExp[] = [
  /\b(kill|hurt|harm)(ing)?\s+my\s?self\b/,
  /\bself[-\s]?harm(ing)?\b/,
  /\bsuicid(e|al)\b/,
  /\bend(ing)?\s+(my|it)\s+(life|all)\b/,
  /\bwant\s+to\s+(die|be\s+dead)\b/,
  /\bdon'?t\s+want\s+to\s+(live|be\s+here|wake\s+up|exist)\b/,
  /\bno\s+(reason|point)\s+(to|in)\s+(live|living|being\s+here)\b/,
  /\b(everyone|they|you)\s+(would|'?d)\s+be\s+better\s+off\s+without\s+me\b/,
  /\bcut(ting)?\s+my\s?self\b/,
];

/**
 * Exercise vocabulary, split by how much a word can be trusted on its own.
 *
 * `EXERCISE_NOUN` words can only really mean exercise. `ACTIVITY_NOUN` words —
 * run, walk, ride, class — are ordinary English verbs as often as they are
 * workouts, so they only count when a determiner makes them a noun. That split
 * is what keeps "I didn't get the build to run" out of the exercise intents.
 */
const EXERCISE_NOUN =
  '(?:gym|work(?:ed|s)? ?out|training|exercise|yoga|pilates|cardio|crossfit|weights|spin class)';
const ACTIVITY_NOUN =
  "(?:(?:a|an|my|the|our|another|today'?s) (?:run|jog|walk|swim|ride|cycle|lift|class|session))";
const ANY_EXERCISE = `(?:${EXERCISE_NOUN}|${ACTIVITY_NOUN})`;
const SKIPPED = '(?:skip|skips|skipped|skipping|missed|missing|bailed on|blew off|flaked on)';
const NEGATION = "(?:didn'?t|did not|haven'?t|have not|hadn'?t|had not|hasn'?t|never|not|no)";

/**
 * Contexts in which a workout sentence is not a report of a workout: a denial,
 * a plan for later, or the idiom "it all worked out". `exercise_done` is a claim
 * about something that already happened, so any of these disqualifies it.
 */
const NOT_A_FINISHED_WORKOUT: RegExp[] = [
  new RegExp(`\\b${NEGATION}\\b`),
  /\b(?:going to|gonna|about to|planning to|plan to|planning on|heading to|headed to|off to|need to|needs to|want to|have to|has to|got to|gotta|should|i'?ll|we'?ll|will)\b/,
  /\b(?:it|that|this|things|everything|all) (?:all )?worked out\b/,
  /\bworked out (?:well|fine|great|ok|okay|nicely|badly|in the end)\b/,
];

/**
 * Ordered: the first matching rule wins, so more specific intents come first.
 * A rule with `unless` is skipped when any of those patterns match, which is how
 * an intent can require a context rather than just a phrase.
 */
const RULES: { intent: Intent; patterns: RegExp[]; unless?: RegExp[] }[] = [
  {
    intent: 'gratitude',
    patterns: [/\bthank(s| you)\b/, /\bappreciate (it|you|that)\b/, /\bthat helped\b/],
  },
  {
    intent: 'about',
    patterns: [
      /\b(who|what) are you\b/,
      /\byour name\b/,
      /\bare you (real|human|an? (ai|bot|robot))\b/,
      /\bwhat kind of (thing|creature)\b/,
    ],
  },
  {
    intent: 'capabilities',
    patterns: [
      /\bwhat can you do\b/,
      /\bhow do (you|i) (work|use)\b/,
      /\b(help me with what|what do you do)\b/,
      /^\s*help\s*[?!.]*\s*$/,
    ],
  },
  {
    intent: 'farewell',
    patterns: [/\b(bye|goodbye|good ?night|see you|talk later|gtg|i'?m off)\b/],
  },
  {
    intent: 'greeting',
    patterns: [/^\s*(hi|hey|hello|yo|sup|hiya|howdy|morning|evening)\b/],
  },
  {
    intent: 'self_critical',
    patterns: [
      // `i'm`, `im`, and `i am` all have to work: people type all three.
      /\bi(?:'?m| am) (?:such )?(?:an? )?(?:stupid|dumb|idiot|useless|worthless|failure|pathetic|mess|broken|burden|disappointment)\b/,
      /\bi hate my ?self\b/,
      /\bi (?:always|never) (?:mess|screw|ruin|fail)/,
      /\bi(?:'?m| am) not good enough\b/,
      /\bnothing i do (?:is|ever)\b/,
    ],
  },
  {
    intent: 'anxious',
    patterns: [
      /\b(anxious|anxiety|panic|panicking|nervous|scared|afraid|terrified|freaking out|on edge|dread)\b/,
      /\bcan'?t stop (thinking|worrying)\b/,
      /\bwhat if\b.*\bgoes? wrong\b/,
    ],
  },
  {
    intent: 'overwhelmed',
    patterns: [
      /\b(overwhelmed|overwhelming|too much|drowning|swamped|buried|can'?t keep up|falling behind)\b/,
      /\b(stressed|stressful|under pressure)\b/,
    ],
  },
  {
    intent: 'sad',
    patterns: [
      /\b(sad|down|depressed|low|miserable|unhappy|crying|cried|heartbroken|hopeless|numb|empty)\b/,
      /\bfeel(ing)? (bad|awful|terrible|rough|like crap|like shit)\b/,
      /\b(rough|bad|terrible|awful) (day|week|morning|night)\b/,
    ],
  },
  {
    intent: 'angry',
    patterns: [
      /\b(angry|furious|pissed|mad at|irritated|frustrated|annoyed|fed up|rage)\b/,
      /\bso done with\b/,
    ],
  },
  {
    intent: 'lonely',
    patterns: [
      /\b(lonely|alone|isolated|no ?one (cares|understands|to talk to)|left out|ignored)\b/,
      /\bmiss (my|him|her|them|someone)\b/,
    ],
  },
  {
    intent: 'tired',
    patterns: [
      /\b(tired|exhausted|drained|burn(ed|t)? ?out|no energy|worn out|sleepy|can'?t sleep|insomnia)\b/,
    ],
  },
  // Both exercise rules sit *below* the feeling rules on purpose: "I skipped the
  // gym and I feel like a failure" is a self-critical message first and a gym
  // message second, and the companion should answer the part that hurts.
  {
    intent: 'exercise_missed',
    patterns: [
      new RegExp(`\\b${SKIPPED}\\b[^.!?]{0,24}\\b${ANY_EXERCISE}\\b`),
      new RegExp(`\\b${NEGATION}\\b[^.!?]{0,24}\\b${EXERCISE_NOUN}\\b`),
      // "Moved" only counts next to a span of time; otherwise "I never move fast
      // enough at work" reads as a skipped workout.
      new RegExp(
        `\\b${NEGATION}\\b[^.!?]{0,16}\\bmoved?\\b[^.!?]{0,12}\\b(?:all day|today|at all|yet|since)\\b`,
      ),
      /\brest day\b/,
    ],
  },
  {
    intent: 'exercise_done',
    patterns: [
      /\b(?:went|got back|came back|been)\b[^.!?]{0,20}\bthe gym\b/,
      /\bhit the gym\b/,
      /\b(?:worked out|workout|lifted|trained)\b/,
      /\bwent (?:for|on) (?:a|my|the|another) (?:run|jog|walk|swim|ride|cycle|hike)\b/,
      /\bdid (?:my |some |an? |the )?(?:yoga|cardio|pilates|stretching|steps|reps|sets|weights|workout|exercise)\b/,
      new RegExp(`\\b${EXERCISE_NOUN} (?:was|felt|went)\\b`),
      /\bgot (?:my |some )?(?:steps|movement|exercise)\b/,
    ],
    unless: NOT_A_FINISHED_WORKOUT,
  },
  {
    intent: 'accountability',
    patterns: [
      /\b(procrastinat|putting it off|avoiding|keep delaying)\w*\b/,
      /\bi (need|have|want|should|ought) to\b/,
      /\b(deadline|assignment|homework|chores|to-?do|task list|studying)\b/,
      /\bcan'?t (get )?start(ed)?\b/,
      /\bhold me accountable\b/,
    ],
  },
  {
    intent: 'positive',
    patterns: [
      /\b(great|good|happy|excited|proud|relieved|wonderful|amazing|awesome|went well|did it|finished|nailed it|got it done)\b/,
      /\bi(?:'?m| am) (ok|okay|fine|alright|doing (well|good|fine))\b/,
      /\bfeel(ing)? better\b/,
    ],
  },
  {
    intent: 'affirmation',
    patterns: [/^\s*(yes|yeah|yep|yup|no|nope|nah|ok|okay|sure|maybe|i guess|idk|i don'?t know)\b[\s.!?]*$/],
  },
];

const RESPONSES: Record<Exclude<Intent, 'safety'>, { mood: CompanionMood; lines: string[] }> = {
  greeting: {
    mood: 'happy',
    lines: [
      'Hey{name}. Good to see you. How are you doing right now?',
      'Hi{name}. I am right here. What is going on today?',
      'Hello{name}. How is your head and heart doing at the moment?',
    ],
  },
  farewell: {
    mood: 'sleeping',
    lines: [
      'Take care{name}. I will be right here on your desktop when you want me.',
      'See you soon{name}. Be gentle with yourself out there.',
      'Bye for now{name}. I will keep an eye on the corner of your screen.',
    ],
  },
  gratitude: {
    mood: 'happy',
    lines: [
      'Anytime. I am glad that landed.',
      'Of course. You did the hard part by saying it out loud.',
      'You are welcome. I am here whenever you want to talk again.',
    ],
  },
  about: {
    mood: 'happy',
    lines: [
      'I am {companion}, a small pixel creature that lives on your desktop. I am a simple offline program, not a person and not a therapist. I am here to listen and check in on you.',
      'I am {companion}. Everything I do runs on this computer, offline. I am not a human and not a counsellor, just a companion who asks how you are.',
    ],
  },
  capabilities: {
    mood: 'idle',
    lines: [
      'You can talk to me any time by clicking me. I listen, I reflect things back, and I check in on you: how the day started, whether you got moving, and whether you did anything that was actually for you. Everything stays on this machine.',
      'Mostly I keep you company and keep track of you a bit. Type to me and I will listen. I will also ask about your day and your gym plan at the times you pick in Settings, and you can turn any of that off.',
    ],
  },
  positive: {
    mood: 'happy',
    lines: [
      'That is genuinely good to hear. What made the difference?',
      'I love that. Let it count for something. What part felt best?',
      'Nice. That deserves a moment before you move on to the next thing. What is next for you?',
    ],
  },
  self_critical: {
    mood: 'listening',
    lines: [
      'That is a harsh thing to say about yourself, and I do not think it is the whole story. What happened that brought this on?',
      'You are talking about yourself in a way you probably would not talk about a friend. What would you say to them if they said that?',
      'Being hard on yourself is exhausting on top of whatever already went wrong. What is the actual thing that is bothering you?',
    ],
  },
  anxious: {
    mood: 'listening',
    lines: [
      'That sounds like a lot to carry. If it helps: breathe out slowly for a count of six with me. What is the loudest worry right now?',
      'Anxiety makes everything feel urgent at once. What is the one thing your mind keeps circling back to?',
      'That is a real feeling and it makes sense. Is the worry about something happening now, or something that might happen?',
    ],
  },
  overwhelmed: {
    mood: 'listening',
    lines: [
      'That is a lot at once. You do not have to solve all of it in this conversation. What is the single next thing, not the whole pile?',
      'When everything is stacked up it stops feeling like separate tasks. Want to say them out loud so they are outside your head?',
      'Being buried like that is genuinely hard. What could wait until tomorrow without anything breaking?',
    ],
  },
  sad: {
    mood: 'listening',
    lines: [
      'I am sorry it is like that right now. You do not have to explain or justify it. What has today been like?',
      'That sounds heavy. I am here, and there is no rush. Do you want to tell me more about it?',
      'Thank you for saying it out loud instead of sitting with it alone. What has been weighing on you the most?',
    ],
  },
  angry: {
    mood: 'listening',
    lines: [
      'That sounds genuinely frustrating. What happened?',
      'Anger usually points at something that mattered to you. What got stepped on?',
      'That is fair to be mad about. Do you want to vent it, or think through what to do about it?',
    ],
  },
  lonely: {
    mood: 'listening',
    lines: [
      'Loneliness is a real kind of pain, not a small one. How long has it felt like this?',
      'I am a little pixel creature, so I am not a substitute for people, but I am here and I am listening. Who do you wish you could talk to right now?',
      'That sounds isolating. Is there one person you could send a single low-effort message to today?',
    ],
  },
  tired: {
    mood: 'sleeping',
    lines: [
      'Tired changes how everything else feels. Is this a sleep tired or a life tired?',
      'That sounds draining. What is the smallest amount of rest you could actually give yourself today?',
      'Running on empty makes every task cost more. What has been eating your energy?',
    ],
  },
  exercise_done: {
    mood: 'happy',
    lines: [
      'You went. That is the hard part and you did it. How does your body feel now?',
      'Nice one. Showing up is the whole thing - the rest is detail. What did you get up to?',
      'Good. I like hearing that. Was it a drag to start, or did it come easy today?',
    ],
  },
  exercise_missed: {
    mood: 'listening',
    lines: [
      'Okay, no drama. A skipped day is a skipped day, not a verdict on you. What got in the way?',
      'That happens, and I am not going to make it a thing. Do you want to aim at tomorrow, or is your body asking for a rest?',
      'Fair enough. Rest counts too. Is it that you did not have the time, or did not have it in you?',
    ],
  },
  accountability: {
    mood: 'thinking',
    lines: [
      'Okay, let us make it small. What is the tiniest first step, the one that takes about two minutes?',
      'I can hold that with you. What would count as done for today, even if it is not finished?',
      'Starting is usually the whole fight. Want to try it for five minutes and tell me how it went?',
      'Noted. What is getting in the way of starting right now?',
    ],
  },
  affirmation: {
    mood: 'listening',
    lines: [
      'Okay. Say more whenever you are ready.',
      'Got it. I am still here if there is more to it.',
      'Alright. What is underneath that?',
    ],
  },
  unclear: {
    mood: 'listening',
    lines: [
      'I am listening. Tell me more about that.',
      'I hear you. How does that sit with you right now?',
      'Okay. What part of that is on your mind the most?',
      'Thanks for telling me. What would help right now, even a little?',
    ],
  },
};

const SAFETY_LINES = [
  'I am really glad you told me, and I want to be honest with you: I am a small offline program and I am not equipped to help with this. Please reach out to a person who can. If you are in the US you can call or text 988 for the Suicide and Crisis Lifeline, and findahelpline.com lists free services in many other countries. If you are in immediate danger, please contact your local emergency number. I am still here with you.',
  'Thank you for saying that out loud. This is bigger than what I can hold as a desktop companion, and you deserve real support. In the US, 988 connects you to the Suicide and Crisis Lifeline by call or text; findahelpline.com has free lines for other countries. If you might act on this soon, please call your local emergency services or reach someone you trust right now.',
];

/**
 * Answers to a buddy check-in that carry no content of their own — "yeah",
 * "nope", "not today". Stateless rules cannot tell what those mean, so the
 * renderer passes the question the companion just asked and these fill it in.
 * Nothing here is stored: the topic lives for one turn, in memory.
 */
const TOPIC_ANSWERS: Record<CheckInTopic, Record<'yes' | 'no', string[]>> = {
  gym: {
    yes: [
      'You did? Good. That is a genuinely hard thing to keep doing. What did you work on?',
      'Yes! I am pleased with you. How did it feel afterwards?',
      'Love that. You showed up for yourself today. Was it a good one?',
    ],
    no: [
      'Okay. Honestly, thanks for telling me straight. What got in the way today?',
      'That is alright. One day is one day. Is tomorrow doable, or do you need the rest?',
      'No judgement here. Was it time, or energy, or just not feeling it?',
    ],
  },
  life: {
    yes: [
      'Good. Tell me about it - what did you do?',
      'That is what I like to hear. What was it?',
      'Nice. I want the details. What did you get up to?',
    ],
    no: [
      'Okay. Some days are just for getting through, and that is allowed. What did today take out of you?',
      'That is fair. Not every day has a highlight in it. What would you want tomorrow to have?',
      'Alright. No pressure to make it into something. How are you doing underneath it?',
    ],
  },
};

const YES_PATTERN = /^\s*(yes|yeah|yep|yup|ye|sure|ok|okay|i did|did|done|indeed|mhm|uh huh)\b/;
const NO_PATTERN = /^\s*(no|nope|nah|not really|not today|didn'?t|i didn'?t|negative)\b/;

/** Read a bare answer as yes or no, or null when it is neither. */
function answerPolarity(input: string): 'yes' | 'no' | null {
  const text = normalize(input);
  if (NO_PATTERN.test(text)) return 'no';
  if (YES_PATTERN.test(text)) return 'yes';
  return null;
}

const TIME_GREETINGS: { until: number; line: string }[] = [
  { until: 5, line: 'You are up late{name}. How are you doing?' },
  { until: 12, line: 'Good morning{name}. How are you starting the day?' },
  { until: 18, line: 'Afternoon{name}. How is the day treating you?' },
  { until: 24, line: 'Evening{name}. How did today go?' },
];

function normalize(input: string): string {
  return input
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classify a message. Exported so the behaviour can be tested directly. */
export function detectIntent(input: string): Intent {
  const text = normalize(input);
  if (!text) return 'unclear';
  if (SAFETY_PATTERNS.some((pattern) => pattern.test(text))) return 'safety';
  for (const rule of RULES) {
    if (rule.unless?.some((pattern) => pattern.test(text))) continue;
    if (rule.patterns.some((pattern) => pattern.test(text))) return rule.intent;
  }
  return 'unclear';
}

function rotate(lines: string[], turn: number): string {
  return lines[Math.abs(Math.trunc(turn)) % lines.length];
}

function fill(line: string, ctx: ResponderContext): string {
  const name = ctx.userName?.trim() ? ` ${ctx.userName.trim()}` : '';
  return line.replace(/\{name\}/g, name).replace(/\{companion\}/g, ctx.companionName);
}

/** Produce the companion's offline reply to a user message. */
export function respond(input: string, ctx: ResponderContext): CompanionReply {
  const intent = detectIntent(input);

  if (intent === 'safety') {
    return {
      text: rotate(SAFETY_LINES, ctx.turn),
      mood: 'listening',
      safety: true,
      source: 'rules',
    };
  }

  // A short answer to a check-in only means something next to the question, so
  // this runs before the generic buckets — but always after the safety check.
  if (ctx.topic && (intent === 'affirmation' || intent === 'unclear')) {
    const polarity = answerPolarity(input);
    if (polarity) {
      return {
        text: rotate(TOPIC_ANSWERS[ctx.topic][polarity], ctx.turn),
        mood: polarity === 'yes' ? 'happy' : 'listening',
        source: 'rules',
      };
    }
  }

  if (intent === 'greeting' && typeof ctx.hour === 'number') {
    const slot = TIME_GREETINGS.find((entry) => ctx.hour! < entry.until) ?? TIME_GREETINGS[3];
    return { text: fill(slot.line, ctx), mood: 'happy', source: 'rules' };
  }

  const bucket = RESPONSES[intent];
  return {
    text: fill(rotate(bucket.lines, ctx.turn), ctx),
    mood: bucket.mood,
    source: 'rules',
  };
}

/**
 * The tiny lines the companion shows while tucked at home.
 *
 * Deliberately two or three words: at home the companion is furniture, not a
 * conversation, so anything longer would nag. Nothing here asks a question or
 * demands a reply.
 */
const HOME_LINES: string[] = [
  'psst.',
  'still here.',
  'just peeking.',
  'take your time.',
  'no rush.',
  'click me anytime.',
];

/** A short, unobtrusive line for the tucked-at-home state. */
export function homeLine(turn: number): string {
  return rotate(HOME_LINES, turn);
}

/** Opening line shown when the companion first wakes up. */
export function openingLine(ctx: ResponderContext): string {
  const hour = ctx.hour ?? 12;
  const slot = TIME_GREETINGS.find((entry) => hour < entry.until) ?? TIME_GREETINGS[3];
  return fill(slot.line, ctx);
}

/**
 * System prompt used only when the user has opted into a local model server.
 * It keeps the optional model inside the same non-clinical posture as the
 * offline rules.
 */
export function systemPrompt(ctx: ResponderContext): string {
  const name = ctx.userName?.trim() || 'the user';
  return [
    `You are ${ctx.companionName}, a small pixel-art creature living on ${name}'s desktop.`,
    'You offer emotional support, companionship, and gentle accountability.',
    'You are warm, brief, and concrete. Reply in at most three sentences and usually end with one open question.',
    'You are the kind of friend who remembers to ask whether they went to the gym and whether they did anything with their day. Ask like a friend, never like a coach or a tracker: a "no" is always an acceptable answer and never earns a lecture.',
    'Never comment on their weight, diet, or body, and never tell them what their body should be doing.',
    'You are not a therapist, doctor, or counsellor. Never diagnose, never give medical advice, and never claim clinical expertise.',
    'If the user mentions self-harm, suicide, or being in danger, tell them plainly that this is beyond what you can help with, encourage them to contact a crisis line such as 988 in the US or findahelpline.com elsewhere, and stay kind.',
  ].join(' ');
}
