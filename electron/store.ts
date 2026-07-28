import { app } from 'electron';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { mergeCheckInState, mergeSettings } from '../src/shared/defaults';
import type { AppSettings, CheckInState } from '../src/shared/types';

/**
 * Local-only JSON persistence.
 *
 * Everything the app remembers lives in two small files under the OS per-user
 * app-data directory. There is no database, no sync, and no telemetry, and
 * conversation transcripts are deliberately never written to disk.
 */

let settingsPath = '';
let statePath = '';

function paths(): { settings: string; state: string } {
  if (!settingsPath) {
    const dir = app.getPath('userData');
    settingsPath = join(dir, 'settings.json');
    statePath = join(dir, 'checkin-state.json');
  }
  return { settings: settingsPath, state: statePath };
}

function readJson(file: string): unknown {
  try {
    if (!existsSync(file)) return null;
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // A corrupt file should never stop the app from starting.
    return null;
  }
}

/** Write via a temp file + rename so a crash mid-write cannot truncate settings. */
function writeJson(file: string, value: unknown): void {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const temp = `${file}.tmp`;
    writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
    renameSync(temp, file);
  } catch (error) {
    console.error('[pixel-companion] failed to persist', file, error);
  }
}

export function loadSettings(): AppSettings {
  return mergeSettings(readJson(paths().settings));
}

export function saveSettings(settings: AppSettings): void {
  writeJson(paths().settings, settings);
}

export function loadCheckInState(): CheckInState {
  return mergeCheckInState(readJson(paths().state));
}

export function saveCheckInState(state: CheckInState): void {
  writeJson(paths().state, state);
}

/** Shown in the settings panel so users can see exactly where their data is. */
export function dataDirectory(): string {
  return dirname(paths().settings);
}
