import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
process.env.TEMP = resolve(".local/tmp");
process.env.TMP = process.env.TEMP;
const root = resolve("output/playwright/simple-schedules-2026-11-16/desktop").replaceAll("\\", "/");
const cli =
  process.env.KOOYU_PLAYWRIGHT_CLI ??
  readdirSync(".local/npm-cache/_npx")
    .map((folder) =>
      join(".local/npm-cache/_npx", folder, "node_modules/@playwright/cli/playwright-cli.js"),
    )
    .find(existsSync);
if (!cli) throw Error("Install @playwright/cli before verification");
mkdirSync(root, { recursive: true });
const stages = {
  controls: `const frequency=page.getByRole('combobox',{name:'执行频率',exact:true});await frequency.selectOption('once');await page.getByLabel('执行日期',{exact:true}).fill('2027-01-20');const date=page.getByLabel('执行日期',{exact:true});await date.focus();await date.pressSequentially('garbage');if(await date.inputValue()!=='2027-01-20')throw Error('Date field accepted text');await page.getByText('高级设置',{exact:true}).click();if(await page.getByRole('spinbutton',{name:'累计运行上限（0 不限制）',exact:true}).inputValue()!=='0')throw Error('Default count must be 0');if(await page.getByRole('spinbutton',{name:'累计费用上限 USD（0 不限制）',exact:true}).inputValue()!=='0')throw Error('Default cost must be 0');await date.scrollIntoViewIfNeeded();await shot('12-picker-zero-limits');`,
  cross: `await page.getByRole('button',{name:'刷新',exact:true}).last().click();await page.getByText(/每隔 2 小时/).waitFor();await shot('11-mobile-shared');const plans=await page.evaluate(async()=>{const r=await fetch('/api/automations');return r.json();});if(plans.some(p=>p.enabled))throw Error('Fixture tasks must remain paused');`,
  chat: `await page.getByRole('button',{name:/^定时任务对话验收 主对话/}).click();await page.getByRole('textbox',{name:'消息',exact:true}).fill('ScheduleQA 每天上午9点检查项目');await page.getByRole('button',{name:'发送消息',exact:true}).click();await page.getByRole('button',{name:'允许本次',exact:true}).waitFor();await shot('09-conversation-approval');`,
  accepted: `await page.getByText(/已创建定时任务「/).waitFor();await shot('10-conversation-created');`,
  accept: `await page.getByRole('button',{name:'允许本次',exact:true}).click();await page.getByText(/已创建定时任务「/).waitFor();await shot('10-conversation-created');const plans=await page.evaluate(async()=>{const r=await fetch('/api/automations');return r.json();});if(!plans.some(p=>p.name==='对话创建的每日检查'&&p.trigger.kind==='calendar'&&!p.enabled))throw Error('Missing conversation plan');`,
  editor: `await page.getByRole('button',{name:'工作中心',exact:true}).click();await page.getByRole('combobox',{name:'管理的主对话',exact:true}).selectOption({label:'平台验收主对话'});await page.getByRole('button',{name:'编辑',exact:true}).click();await page.getByRole('textbox',{name:'计划名称',exact:true}).scrollIntoViewIfNeeded();await shot('01-time-editor');const frequency=page.getByRole('combobox',{name:'执行频率',exact:true});await frequency.selectOption('once');await page.getByLabel('执行日期',{exact:true}).fill('2027-01-20');await page.getByLabel('执行时间',{exact:true}).fill('10:30');await shot('02-once-date-time');await frequency.selectOption('weekly');await page.getByLabel('周三',{exact:true}).check();await shot('03-weekly');await frequency.selectOption('monthly');await page.getByRole('combobox',{name:/^每月几号/}).selectOption('31');await shot('04-monthly');await frequency.selectOption('interval');await page.getByRole('spinbutton',{name:'每隔',exact:true}).fill('90');await page.getByRole('combobox',{name:'间隔单位',exact:true}).selectOption('minutes');await Promise.all([page.waitForResponse(r=>r.url().endsWith('/api/automations/preview')),page.getByRole('button',{name:'预览运行时间',exact:true}).click()]);await shot('05-interval-preview');await Promise.all([page.waitForResponse(r=>r.url().includes('/api/automations/')&&r.request().method()==='PATCH'),page.getByRole('button',{name:'保存计划',exact:true}).click()]);const plans=await page.evaluate(async()=>{const r=await fetch('/api/automations');return r.json();});const p=plans.find(p=>p.name==='项目每日检查');if(p.trigger.kind!=='interval'||p.trigger.every!==90||p.enabled)throw Error('Interval state not preserved');await shot('06-saved-interval');await page.getByRole('button',{name:'深色主题',exact:true}).click();await shot('07-dark');await page.getByRole('button',{name:'浅色主题',exact:true}).click();await page.setViewportSize({width:390,height:844});await shot('08-narrow');if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw Error('Horizontal overflow');await page.setViewportSize({width:1440,height:1050});`,
};
const stage = process.argv[2] ?? "chat";
if (!stages[stage]) throw Error("Unknown stage");
const code =
  "async(page)=>{const shot=async(id)=>page.screenshot({path:" +
  JSON.stringify(root) +
  "+'/'+id+'.png',fullPage:true});await page.setViewportSize({width:1440,height:1050});" +
  stages[stage] +
  "}";
const result = execFileSync(process.execPath, [cli, "-s=kooyu-schedule-6493", "run-code", code], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 90000,
});
console.log(result);
if (result.includes("### Error")) process.exitCode = 1;
writeFileSync(
  root + "/" + stage + "-result.json",
  JSON.stringify({ stage, result, synthetic: true, modelInference: false }, null, 2),
);
