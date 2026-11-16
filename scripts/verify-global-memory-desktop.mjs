import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const stage = process.argv[2] ?? "manage";
const root = resolve("output/playwright/global-memory-2026-11-16/desktop").replaceAll("\\", "/");
mkdirSync(root, { recursive: true });
const cache = resolve(".local/npm-cache/_npx");
const cli =
  process.env.KOOYU_PLAYWRIGHT_CLI ??
  readdirSync(cache)
    .map((folder) => join(cache, folder, "node_modules/@playwright/cli/playwright-cli.js"))
    .find(existsSync);
if (!cli) throw Error("Install @playwright/cli before verification");
const setup = `if(new URL(page.url()).origin!=='http://127.0.0.1:4397')throw Error('Wrong Host');const shot=async(name)=>page.screenshot({path:${JSON.stringify(root)}+'/'+name+'.png',fullPage:true});`;
const scripts = {
  final: `
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.getByRole('button',{name:'全局记忆',exact:true}).click();await page.getByRole('switch',{name:'启用全局记忆',exact:true}).waitFor();
await shot('09-final-settings');
await page.getByText('查看来源',{exact:true}).first().click();await shot('10-final-provenance');
await page.getByRole('button',{name:'新增记忆',exact:true}).click();
if(!(await page.getByRole('textbox',{name:'记忆主题',exact:true}).evaluate(e=>e===document.activeElement)))throw Error('Editor was not focused');
await page.getByRole('textbox',{name:'记忆主题',exact:true}).fill('Final editor check');await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('Nothing is sent until saved.');await shot('11-final-editor');
await page.getByRole('button',{name:'取消',exact:true}).click();
await page.getByRole('button',{name:'深色主题',exact:true}).click();await page.locator('html.dark').waitFor();await shot('12-final-dark');await page.getByRole('button',{name:'浅色主题',exact:true}).click();await page.locator('html:not(.dark)').waitFor();
await page.setViewportSize({width:390,height:844});await shot('13-final-narrow');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');await page.setViewportSize({width:1440,height:1000});
if(errors.length)throw Error(errors.join(';'));`,
  manage: `
await page.getByRole('textbox',{name:'记忆主题',exact:true}).fill('Desktop preference');await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('Prefer verified results');await shot('04-editor');
await page.getByRole('button',{name:'保存并确认',exact:true}).click();await page.getByRole('textbox',{name:'记忆主题',exact:true}).waitFor({state:'detached'});
const row=page.locator('.sx-row').filter({hasText:'Desktop preference'});await row.getByRole('button',{name:'编辑',exact:true}).click();
await page.getByRole('textbox',{name:'记忆内容',exact:true}).fill('Prefer verified results and limitations');await page.getByRole('button',{name:'保存并确认',exact:true}).click();await page.getByRole('textbox',{name:'记忆主题',exact:true}).waitFor({state:'detached'});
page.once('dialog',d=>d.accept());await row.getByRole('button',{name:'删除',exact:true}).click();await page.getByText('Desktop preference',{exact:true}).waitFor({state:'detached'});
await page.getByRole('button',{name:'深色主题',exact:true}).click();await page.locator('html.dark').waitFor();await shot('05-dark');await page.getByRole('button',{name:'浅色主题',exact:true}).click();await page.locator('html:not(.dark)').waitFor();
await page.setViewportSize({width:390,height:844});await shot('06-narrow');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');await page.setViewportSize({width:1440,height:1000});`,
  cross: `
await page.getByRole('button',{name:'刷新全局记忆',exact:true}).click();
const config=await page.evaluate(async()=>{const r=await fetch('/api/memory/settings');return r.json()});if(!config.automaticSaving||!config.enabled)throw Error('Mobile settings not shared');
await page.getByText('Mobile preference',{exact:true}).waitFor();await page.getByText('Use short summaries',{exact:true}).waitFor();await shot('07-mobile-shared');`,
  disabled: `
await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/memory/settings')&&r.request().method()==='GET'),page.getByRole('button',{name:'刷新全局记忆',exact:true}).click()]);
await page.getByRole('switch',{name:'启用全局记忆',exact:true}).click();
await page.waitForFunction(()=>{const s=document.querySelector('[role="switch"][aria-label="启用全局记忆"]');return s?.getAttribute('aria-checked')==='false'&&!s.disabled;});
if(!(await page.getByRole('switch',{name:'自动保存对话记忆',exact:true}).isDisabled()))throw Error('Automatic switch enabled while global disabled');await shot('08-disabled');
await page.getByRole('switch',{name:'启用全局记忆',exact:true}).click();
await page.waitForFunction(()=>{const s=document.querySelector('[role="switch"][aria-label="启用全局记忆"]');return s?.getAttribute('aria-checked')==='true'&&!s.disabled;});`,
};
if (!scripts[stage]) throw Error("Unknown stage");
const output = execFileSync(
  process.execPath,
  [cli, "-s=global-memory", "run-code", `async(page)=>{${setup}${scripts[stage]}}`],
  { encoding: "utf8", windowsHide: true, timeout: 120000, maxBuffer: 2e6 },
);
console.log(output);
if (output.includes("### Error")) process.exit(1);
writeFileSync(
  root + "/" + stage + ".json",
  JSON.stringify(
    {
      stage,
      result: "passed",
      fixture: true,
      modelInference: false,
      finishedAt: new Date().toISOString(),
    },
    null,
    2,
  ),
);
