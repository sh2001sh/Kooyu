// Drive the already opened Playwright CLI browser against the isolated fixture.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
const cache = resolve(".local/npm-cache/_npx");
const cli =
  process.env.KOOYU_PLAYWRIGHT_CLI ??
  readdirSync(cache)
    .map((folder) => join(cache, folder, "node_modules/@playwright/cli/playwright-cli.js"))
    .find((file) => existsSync(file));
if (!cli)
  throw new Error("Run npx --package @playwright/cli playwright-cli open before verification");
const root = resolve("output/playwright/marvis-workbench-2026-11-15/desktop");
mkdirSync(root, { recursive: true });
const fixture = JSON.parse(
  readFileSync(".local/verification/marvis-workbench-20261115/fixture.json", "utf8"),
);
if (!fixture.fixture) throw new Error("Refusing non-fixture Host");
const stage = process.argv[2] ?? "pages";
const run = (code) => {
  const output = execFileSync(process.execPath, [cli, "run-code", code], {
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
    maxBuffer: 2e6,
  });
  console.log(output);
  if (output.includes("### Error")) throw new Error("Browser verification failed");
};
const setup = `if (new URL(page.url()).origin !== ${JSON.stringify(fixture.url)}) throw new Error('Browser is not on the isolated fixture'); const root = ${JSON.stringify(root.replaceAll("\\", "/"))}; const shot = async (name) => { await page.screenshot({path:root+'/'+name+'.png',fullPage:true}); };`;
if (stage === "confirm")
  run(`async (page) => {
  ${setup}
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.reload();
  await page.getByRole('button',{name:'工作记录与成果',exact:true}).click();
  await page.getByRole('heading',{name:'我的工作',exact:true}).waitFor();
  await page.getByRole('button',{name:/跨端工作台优化验收/}).waitFor();
  await shot('01-work');
  await page.getByRole('combobox',{name:'项目范围'}).selectOption('${fixture.projectId}');
  await page.getByRole('heading',{name:'平台验收演示项目',exact:true}).waitFor();
  await shot('02-project-work');
  const nav=page.getByRole('navigation',{name:'工作视图'});
  for (const [tab,id] of [['成果','03-artifacts'],['自动计划','04-plans'],['项目概览','05-project'],['项目约定','06-memory'],['执行能力','07-capabilities'],['常用任务','08-templates']]) {
    await nav.getByRole('button',{name:tab,exact:true}).click();
    await page.locator('main').ariaSnapshot(); await shot(id);
  }
  await nav.getByRole('button',{name:'工作记录',exact:true}).click();
  await page.getByRole('button',{name:/跨端工作台优化验收/}).click();
  await page.getByLabel('工作详情',{exact:true}).waitFor();
  await shot('15-goal-detail');
  await page.getByRole('button',{name:'关闭详情',exact:true}).click();
  await page.setViewportSize({width:390,height:844}); await shot('11-narrow-work');
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Page overflow');
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'深色主题',exact:true}).click();
  await page.locator('html.dark').waitFor(); await shot('12-dark-work');
  await page.getByRole('button',{name:'浅色主题',exact:true}).click(); await page.locator('html:not(.dark)').waitFor();
  await nav.getByRole('button',{name:'成果',exact:true}).click();
  await page.getByRole('button',{name:'返回来源对话',exact:true}).click();
  const draft=page.getByRole('textbox',{name:'消息',exact:true}); await draft.waitFor();
  await draft.fill('保留这条未发送草稿，供跨页面恢复验证。');
  await page.getByRole('button',{name:'项目工作与成果',exact:true}).click();
  await page.getByRole('button',{name:'返回对话',exact:true}).click();
  if(await draft.inputValue()!=='保留这条未发送草稿，供跨页面恢复验证。') throw new Error('Draft lost while viewing work');
  await page.getByRole('complementary',{name:'导航与会话'}).getByRole('button',{name:/Android 与桌面互通验收 Codex/}).click();
  await page.getByRole('complementary',{name:'导航与会话'}).getByRole('button',{name:/平台验收主对话 主对话/}).click();
  if(await draft.inputValue()!=='保留这条未发送草稿，供跨页面恢复验证。') throw new Error('Draft lost across conversations');
  await shot('16-restored-draft');
  await draft.fill('');
  if(errors.length) throw new Error(errors.join(';'));
}`);
if (stage === "pages")
  run(`async (page) => {
  ${setup}
  await page.setViewportSize({width:1440,height:960});
  await shot('01-work');
  await page.getByRole('combobox',{name:'项目范围'}).selectOption('${fixture.projectId}');
  await page.getByRole('heading',{name:'平台验收演示项目',exact:true}).waitFor();
  await shot('02-project-work');
  for (const [tab,id] of [['成果','03-artifacts'],['自动计划','04-plans'],['项目概览','05-project'],['项目约定','06-memory'],['执行能力','07-capabilities'],['常用任务','08-templates']]) {
    await page.getByRole('navigation',{name:'工作视图'}).getByRole('button',{name:tab,exact:true}).click();
    await shot(id);
  }
  await page.getByRole('navigation',{name:'工作视图'}).getByRole('button',{name:'成果',exact:true}).click();
  await page.getByRole('button',{name:'预览',exact:true}).click();
  await page.getByTitle('成果预览').waitFor();
  await shot('09-artifact-preview');
  await page.getByRole('button',{name:'关闭详情',exact:true}).click();
  await page.getByRole('navigation',{name:'工作视图'}).getByRole('button',{name:'自动计划',exact:true}).click();
  await page.getByRole('button',{name:'编辑与运行记录',exact:true}).click();
  await page.getByRole('button',{name:'预览时间',exact:true}).click();
  await page.locator('.hub-editor p').filter({hasText:'Asia/Shanghai'}).first().waitFor();
  await shot('10-plan-detail');
  console.log(await page.locator('main').ariaSnapshot());
}`);
if (stage === "narrow")
  run(`async (page) => {
  ${setup}
  await page.getByRole('button',{name:'关闭',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('navigation',{name:'工作视图'}).getByRole('button',{name:'工作记录',exact:true}).click();
  await shot('11-narrow-work');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  if (overflow) throw new Error('Horizontal page overflow');
  await page.setViewportSize({width:1440,height:960});
  await page.getByRole('button',{name:'深色主题',exact:true}).click();
  await page.locator('html.dark').waitFor();
  await shot('12-dark-work');
  await page.getByRole('button',{name:'浅色主题',exact:true}).click();
  await page.locator('html:not(.dark)').waitFor();
  console.log(await page.locator('main').ariaSnapshot());
}`);
if (stage === "mutations")
  run(`async (page) => {
  ${setup}
  const nav = page.getByRole('navigation',{name:'工作视图'});
  await nav.getByRole('button',{name:'项目约定',exact:true}).click();
  await page.locator('.hub-row').filter({hasText:'交付约定'}).getByRole('button',{name:'查看与编辑',exact:true}).click();
  await page.getByRole('textbox',{name:'约定内容'}).fill('交付时附实际验证结果，标明尚未验证的部分。桌面与手机已核对。');
  await shot('13-memory-editor');
  await page.getByRole('button',{name:'保存并确认',exact:true}).click();
  await page.getByText('交付时附实际验证结果，标明尚未验证的部分。桌面与手机已核对。',{exact:true}).waitFor();
  await nav.getByRole('button',{name:'自动计划',exact:true}).click();
  await page.getByRole('button',{name:'编辑与运行记录',exact:true}).click();
  await page.getByRole('button',{name:'保存并启用',exact:true}).click();
  await page.locator('.hub-row').filter({hasText:'项目每日检查'}).filter({hasText:'已启用'}).waitFor();
  await page.getByRole('button',{name:'编辑与运行记录',exact:true}).click();
  await page.getByRole('button',{name:'暂停计划',exact:true}).click();
  await page.locator('.hub-row').filter({hasText:'项目每日检查'}).filter({hasText:'已暂停'}).waitFor();
  await nav.getByRole('button',{name:'常用任务',exact:true}).click();
  await page.getByRole('button',{name:/检查项目 请检查/}).click();
  const draft = page.getByRole('textbox',{name:'消息',exact:true});
  if (!(await draft.inputValue()).includes('请检查当前项目')) throw new Error('Template was not editable draft');
  await shot('14-template-draft');
  console.log('PASS: memory saved; plan enabled then paused; template stays editable and unsent.');
}`);
writeFileSync(
  join(root, stage + ".json"),
  JSON.stringify(
    {
      verifiedAt: new Date().toISOString(),
      stage,
      fixture: true,
      modelInference: false,
      result: "passed",
    },
    null,
    2,
  ),
);
