import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The settings panel is markup, not code, so these tests read `index.html`
 * directly. They exist to pin the one thing a first-time user experiences and
 * that no other test can see: the settings they land on are short, plain, and
 * free of anything they would have to look up.
 */
const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');

/** The settings drawer, from its container up to the speech bubble after it. */
function settingsMarkup(): string {
  const start = html.indexOf('id="settings-view"');
  const end = html.indexOf('id="bubble"');
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end);
}

/** The folded-away Advanced section. */
function advancedMarkup(): string {
  const settings = settingsMarkup();
  const start = settings.indexOf('id="advanced"');
  expect(start).toBeGreaterThan(-1);
  const end = settings.indexOf('</details>', start);
  expect(end).toBeGreaterThan(start);
  return settings.slice(start, end);
}

/** Everything a user sees before opening Advanced. */
function defaultViewMarkup(): string {
  const settings = settingsMarkup();
  const start = settings.indexOf('<details');
  return settings.slice(0, start);
}

/** Strip HTML comments and tags, leaving only what is actually on screen. */
function visibleText(markup: string): string {
  return markup
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
}

describe('settings panel', () => {
  it('folds every power-user control away behind Advanced', () => {
    const advanced = advancedMarkup();
    for (const id of [
      'set-model-enabled',
      'set-model-endpoint',
      'set-model-name',
      'set-model-key',
      'set-model-timeout',
    ]) {
      expect(advanced).toContain(`id="${id}"`);
      expect(defaultViewMarkup()).not.toContain(`id="${id}"`);
    }
  });

  it('keeps the API key and the give-up time reachable, not dropped', () => {
    // They were previously unreachable from the UI entirely; hiding them behind
    // a disclosure is the point, losing them is not.
    expect(advancedMarkup()).toContain('id="set-model-key"');
    expect(advancedMarkup()).toContain('id="set-model-timeout"');
  });

  it('starts folded, so the default view is what a new user sees', () => {
    const settings = settingsMarkup();
    const tag = settings.slice(settings.indexOf('<details'), settings.indexOf('id="advanced"') + 20);
    expect(tag).not.toContain(' open');
  });

  it('leaves the everyday controls in the open', () => {
    const view = defaultViewMarkup();
    for (const id of [
      'set-checkins-enabled',
      'set-gym-enabled',
      'set-speak-replies',
      'set-mic-enabled',
      'set-user-name',
      'set-scale',
      'set-always-on-top',
    ]) {
      expect(view).toContain(`id="${id}"`);
    }
  });

  it('groups the default view under a handful of plain headings', () => {
    const view = defaultViewMarkup();
    const headings = [...view.matchAll(/<h2 class="group__title">([^<]+)<\/h2>/g)].map((m) => m[1]);
    expect(headings).toEqual(['Check-ins', 'Voice', 'Names', 'On screen']);
  });

  it('shows no technical wording before Advanced is opened', () => {
    const text = visibleText(defaultViewMarkup()).toLowerCase();
    for (const jargon of [
      'endpoint',
      'api',
      'token',
      'timeout',
      'localhost',
      'http',
      'server',
      'telemetry',
      'electron',
      'responder',
      'json',
      'llm',
      'model',
    ]) {
      expect(text, `"${jargon}" is visible without opening Advanced`).not.toContain(jargon);
    }
  });

  it('says out loud that Advanced is optional', () => {
    expect(visibleText(advancedMarkup()).toLowerCase()).toContain('nothing in here is needed');
  });
});
