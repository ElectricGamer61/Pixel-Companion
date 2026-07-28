import { execFile } from 'node:child_process';
import { platform } from 'node:process';

import type { VoiceSettings } from '../src/shared/types';

/**
 * Free, OS-provided text to speech, used as a fallback when the Web Speech API
 * has no usable voices in the renderer (common on Linux Electron builds).
 *
 * Every command here ships with the operating system or is a standard free
 * open-source package. Nothing is downloaded and no paid service is involved.
 */

interface NativeVoice {
  command: string;
  args: (text: string, voice: VoiceSettings) => string[];
}

/** macOS `say` and Windows PowerShell SAPI are always present. Linux varies. */
const CANDIDATES: Record<string, NativeVoice[]> = {
  darwin: [
    {
      command: 'say',
      args: (text, voice) => {
        const args: string[] = [];
        if (voice.voiceName.trim()) args.push('-v', voice.voiceName.trim());
        // `say` takes words per minute; ~175 is its default speaking rate.
        args.push('-r', String(Math.round(175 * voice.rate)), '--', text);
        return args;
      },
    },
  ],
  win32: [
    {
      command: 'powershell.exe',
      args: (text, voice) => [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        buildPowerShell(text, voice),
      ],
    },
  ],
  linux: [
    {
      command: 'spd-say',
      args: (text, voice) => ['-w', '-r', String(clampSpdRate(voice.rate)), '--', text],
    },
    {
      command: 'espeak-ng',
      args: (text, voice) => ['-s', String(Math.round(175 * voice.rate)), '--', text],
    },
    {
      command: 'espeak',
      args: (text, voice) => ['-s', String(Math.round(175 * voice.rate)), '--', text],
    },
  ],
};

/** speech-dispatcher takes a -100..100 relative rate. */
function clampSpdRate(rate: number): number {
  return Math.max(-100, Math.min(100, Math.round((rate - 1) * 100)));
}

function buildPowerShell(text: string, voice: VoiceSettings): string {
  // Single-quoted PowerShell strings only need doubled single quotes.
  const escaped = text.replace(/'/g, "''");
  const parts = [
    'Add-Type -AssemblyName System.Speech;',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;',
    `$s.Rate = ${Math.max(-10, Math.min(10, Math.round((voice.rate - 1) * 10)))};`,
    `$s.Volume = ${Math.round(Math.max(0, Math.min(1, voice.volume)) * 100)};`,
  ];
  if (voice.voiceName.trim()) {
    parts.push(`try { $s.SelectVoice('${voice.voiceName.replace(/'/g, "''")}') } catch {};`);
  }
  parts.push(`$s.Speak('${escaped}');`);
  return parts.join(' ');
}

let cached: NativeVoice | null | undefined;
let speaking: ReturnType<typeof execFile> | null = null;

function run(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    const child = execFile(command, args, { timeout: 60_000 }, (error) => {
      resolve(!error);
    });
    child.on('error', () => resolve(false));
  });
}

/** Probe once for a usable OS speech command. */
async function detect(): Promise<NativeVoice | null> {
  if (cached !== undefined) return cached;
  const candidates = CANDIDATES[platform] ?? [];
  for (const candidate of candidates) {
    const probe = platform === 'win32' ? true : await run('which', [candidate.command]);
    if (probe) {
      cached = candidate;
      return cached;
    }
  }
  cached = null;
  return cached;
}

export async function nativeSpeechAvailable(): Promise<boolean> {
  return (await detect()) !== null;
}

export async function speakNative(text: string, voice: VoiceSettings): Promise<boolean> {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const engine = await detect();
  if (!engine) return false;

  // Only one utterance at a time; a new reply interrupts the previous one.
  stopNative();
  return new Promise((resolve) => {
    const child = execFile(
      engine.command,
      engine.args(trimmed.slice(0, 1000), voice),
      { timeout: 60_000 },
      (error) => {
        if (speaking === child) speaking = null;
        resolve(!error);
      },
    );
    child.on('error', () => resolve(false));
    speaking = child;
  });
}

export function stopNative(): void {
  if (speaking && !speaking.killed) {
    speaking.kill();
    speaking = null;
  }
}
