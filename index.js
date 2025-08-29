import 'dotenv/config';
import { Agent, run, tool } from '@openai/agents';
import { chromium } from "playwright";
import { z } from 'zod';
import fs from 'fs';
import path from 'path';

let browser;
let page;
const SCREEN_DIR = path.join(process.cwd(), 'screenshots');

function ensureScreenDir() {
  if (!fs.existsSync(SCREEN_DIR)) fs.mkdirSync(SCREEN_DIR, { recursive: true });
}

const openBrowser = tool({
  name: 'open_browser',
  description: 'Opens a browser instance',
  parameters: z.object({}),
  execute: async () => {
    try {
      browser = await chromium.launch({
        headless: false,
        args: [
          '--no-sandbox',
          '--disable-dev-shm-usage',
          '--disable-web-security',
          '--disable-features=VizDisplayCompositor'
        ]
      });
      page = await browser.newPage();
      await page.setViewportSize({ width: 1280, height: 720 });
      return 'Browser opened';
    } catch (error) {
      throw new Error(`Failed to open browser: ${error.message}`);
    }
  }
});

const openURL = tool({
  name: 'open_url',
  description: 'Opens a specified URL in the browser',
  parameters: z.object({ url: z.string() }),
  execute: async ({ url }) => {
    if (!page) throw new Error('Browser not initialized. Call open_browser first.');
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await page.waitForTimeout(1500);
      const title = await page.title();
      return `Opened URL. Title: ${title}`;
    } catch (error) {
      throw new Error(`Failed to navigate to ${url}: ${error.message}`);
    }
  }
});

const takeScreenshot = tool({
  name: 'take_screenshot',
  description: 'Saves a screenshot to disk and returns a tiny message to avoid context bloat',
  parameters: z.object({
    label: z.string().nullable()
  }),
  execute: async ({ label }) => {
    if (!page) throw new Error('Browser not initialized. Call open_browser first.');
    try {
      ensureScreenDir();
      const suffix = label ? String(label).replace(/\W+/g, '_') : '';
      const fname = `shot-${Date.now()}${suffix ? '-' + suffix : ''}.png`;
      const fpath = path.join(SCREEN_DIR, fname);
      await page.screenshot({ path: fpath, fullPage: false, type: 'png' });
      return `Screenshot saved: ${fname}`;
    } catch (error) {
      throw new Error(`Failed to take screenshot: ${error.message}`);
    }
  }
});

const findElements = tool({
  name: 'find_elements',
  description: 'Finds clickable elements by search terms',
  parameters: z.object({
    searchTerms: z.array(z.string())
  }),
  execute: async ({ searchTerms }) => {
    if (!page) throw new Error('Browser not initialized. Call open_browser first.');
    try {
      const elements = await page.evaluate((terms) => {
        const out = [];
        const selectors = [
          'a', 'button', '[role="button"]', 'input[type="button"]',
          'input[type="submit"]', '.btn', '.button', '[onclick]'
        ];
        selectors.forEach(selector => {
          document.querySelectorAll(selector).forEach(el => {
            const rect = el.getBoundingClientRect();
            const text = (el.textContent || el.innerText || '').trim();
            const lowerText = text.toLowerCase();
            if (rect.width > 0 && rect.height > 0) {
              const matches = terms.filter(t =>
                lowerText.includes(t.toLowerCase()) ||
                (el.className && String(el.className).toLowerCase().includes(t.toLowerCase())) ||
                (el.id && String(el.id).toLowerCase().includes(t.toLowerCase()))
              );
              if (matches.length) {
                out.push({
                  text: text.slice(0, 80),
                  tag: el.tagName.toLowerCase(),
                  id: el.id || null,
                  className: (el.className || '').toString().slice(0, 80),
                  confidence: matches.length,
                  center: {
                    x: Math.round(rect.left + rect.width / 2),
                    y: Math.round(rect.top + rect.height / 2)
                  }
                });
              }
            }
          });
        });
        return out.sort((a,b)=>{
          if (a.confidence !== b.confidence) return b.confidence - a.confidence;
          return b.text.length - a.text.length;
        });
      }, searchTerms);

      const trimmed = elements.slice(0, 6);
      return { count: trimmed.length, top: trimmed };
    } catch (error) {
      throw new Error(`Failed to find elements: ${error.message}`);
    }
  }
});

const clickElement = tool({
  name: 'click_element',
  description: 'Clicks on an element by visible text or absolute coordinates',
  parameters: z.object({
    text: z.string().nullable(),
    x: z.number().nullable(),
    y: z.number().nullable()
  }),
  execute: async ({ text, x, y }) => {
    if (!page) throw new Error('Browser not initialized. Call open_browser first.');
    try {
      if (text) {
        const attempts = [
          () => page.getByRole('button', { name: new RegExp(text, 'i') }).click({ timeout: 2000 }),
          () => page.getByRole('link', { name: new RegExp(text, 'i') }).click({ timeout: 2000 }),
          () => page.getByText(text, { exact: false }).click({ timeout: 2000 }),
          () => page.click(`text="${text}"`, { timeout: 2000 }),
          () => page.click(`:has-text("${text}")`, { timeout: 2000 })
        ];
        for (const tryClick of attempts) {
          try { await tryClick(); await page.waitForTimeout(600); return `Clicked "${text}"`; } catch {}
        }
        throw new Error(`Could not click "${text}"`);
      } else if (x != null && y != null) {
        await page.mouse.click(x, y);
        await page.waitForTimeout(600);
        return `Clicked at (${x}, ${y})`;
      } else {
        throw new Error('Provide text or coordinates');
      }
    } catch (error) {
      throw new Error(`Failed to click: ${error.message}`);
    }
  }
});

const fillFormFields = tool({
  name: 'fill_form_fields',
  description: 'Fills signup fields by label, placeholder, name, or id with multiple fallbacks.',
  parameters: z.object({
    firstName: z.string().nullable(),
    lastName: z.string().nullable(),
    fullName: z.string().nullable(),
    email: z.string().nullable(),
    userName: z.string().nullable(),
    password: z.string().nullable(),
    confirmPassword: z.string().nullable(),
    message: z.string().nullable(),
    perFieldDelayMs: z.number().nullable()
  }),
  execute: async ({ firstName, lastName, fullName, email, userName, password, message, confirmPassword, perFieldDelayMs }) => {
    if (!page) throw new Error('Browser not initialized. Call open_browser first.');
    const results = [];
    const delay = typeof perFieldDelayMs === 'number' ? perFieldDelayMs : 120;

    const tryFill = async (labels, value) => {
      if (value == null) return false;
      const attempts = [];
      for (const lbl of labels) {
        const key = lbl.toLowerCase().replace(/\s+/g,'');
        attempts.push(async () => page.getByLabel(new RegExp(`^${lbl}$`, 'i')).fill(value, { timeout: 1000 }));
        attempts.push(async () => page.getByPlaceholder(new RegExp(lbl, 'i')).fill(value, { timeout: 1000 }));
        attempts.push(async () => page.locator(`input[name*="${key}"]`).first().fill(value, { timeout: 1000 }));
        attempts.push(async () => page.locator(`input[id*="${key}"]`).first().fill(value, { timeout: 1000 }));
        attempts.push(async () => {
          const labelEl = page.locator(`label:has-text("${lbl}")`).first();
          const has = await labelEl.count();
          if (!has) throw new Error('label not found');
          const f = await labelEl.getAttribute('for').catch(() => null);
          if (f) {
            await page.locator(`#${f}`).fill(value, { timeout: 1000 });
          } else {
            await labelEl.locator('..').locator('input').first().fill(value, { timeout: 1000 });
          }
        });
      }
      for (const a of attempts) { try { await a(); return true; } catch {} }
      return false;
    };

    const tasks = [
      { key: 'First Name', value: firstName, labels: ['First Name','Firstname','Given Name','First'] },
      { key: 'Last Name',  value: lastName,  labels: ['Last Name','Lastname','Surname','Family Name','Last'] },
      { key: 'Full Name', value: fullName, labels: ['Full Name','Full name','FullName','fullName'] },
      { key: 'Email',      value: email,     labels: ['Email','Email Address','E-mail'] },
      { key: 'Username', value: userName,     labels: ['Username','UserName','User name'] },
      { key: 'Password',   value: password,  labels: ['Password','New Password'] },
      { key: 'Your Message', value: message, labels: ['Your Message', 'message'] },
      { key: 'Confirm Password', value: confirmPassword, labels: ['Confirm Password','Re-enter Password','Retype Password','Confirm'] }
    ];

    for (const t of tasks) {
      if (t.value == null) continue;
      const ok = await tryFill(t.labels, t.value);
      results.push(`${t.key}:${ok?'ok':'missing'}`);
      if (delay) await page.waitForTimeout(delay);
    }
    return results.join('|');
  }
});

const closeBrowser = tool({
  name: 'close_browser',
  description: 'Closes the browser instance',
  parameters: z.object({}),
  execute: async () => {
    try {
      if (browser) {
        await browser.close();
        browser = null;
        page = null;
        return 'Browser closed';
      }
      return 'Browser not open';
    } catch (error) {
      throw new Error(`Failed to close browser: ${error.message}`);
    }
  }
});

const websiteAutomationAgent = new Agent({
  name: 'Website Automation Agent',
  model: 'gpt-4o-mini',
  tools: [openBrowser, openURL, takeScreenshot, findElements, clickElement, fillFormFields, closeBrowser],
  instructions: `You can navigate, find elements, fill forms, and submit.
- Keep tool outputs small (no base64).
- For signup: click "Sign Up", call fill_form_fields with provided values,
  then click a submit button among: "Create Account", "Sign Up", "Register", "Submit".`
});

async function chatWithAgent(query) {
  try {
    const result = await run(websiteAutomationAgent, query);
    console.log('=== AGENT RESPONSE ===');
    console.log(result.finalOutput);
    console.log('=== END RESPONSE ===');
  } catch (error) {
    console.error('Error running agent:', error);
    if (browser) { try { await browser.close(); } catch {} }
  }
}

process.on('SIGINT', async () => { if (browser) await browser.close(); process.exit(0); });
process.on('SIGTERM', async () => { if (browser) await browser.close(); process.exit(0); });

chatWithAgent(`
Open browser, go to https://ui.chaicode.com,
find signup button and click it,
take screenshot labeled signup,
then fill the form with:
First Name Sudhesh,
Last Name Holla,
Email sudheshholla15@gmail.com,
Password admin123,
Confirm Password admin123,
and click Create Account.
`);
