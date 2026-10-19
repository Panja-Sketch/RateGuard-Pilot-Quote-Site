// Locates a local Chromium-based browser for the optional UI end-to-end tests (puppeteer-core).
import fs from 'node:fs';

const CANDIDATES = [
  process.env.PILOT_BROWSER,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

export const findBrowser = () => CANDIDATES.find((p) => fs.existsSync(p)) || null;

export async function launch() {
  const exe = findBrowser();
  if (!exe) return null;
  const puppeteer = (await import('puppeteer-core')).default;
  return puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
}
