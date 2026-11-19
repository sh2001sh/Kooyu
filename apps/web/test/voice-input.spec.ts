import { expect, test, type TestInfo } from "@playwright/test";
import { join } from "node:path";

function shotPath(info: TestInfo, name: string): string {
  return process.env.HIG_SHOT_DIR ? join(process.env.HIG_SHOT_DIR, name) : info.outputPath(name);
}

test.describe("Multi-platform voice input (live SpeechRecognition + Host Whisper fallback)", () => {
  test("Live voice recording strip inserts transcript into composer at 1440px & 390px", async ({
    page,
  }, info) => {
    await page.addInitScript(() => {
      class FakeSpeechRecognition {
        lang = "zh-CN";
        continuous = true;
        interimResults = true;
        maxAlternatives = 1;
        onresult: ((ev: any) => void) | null = null;
        onerror: ((ev: any) => void) | null = null;
        onend: (() => void) | null = null;
        private active = false;

        start() {
          this.active = true;
          (window as any).__lastVoiceRec = this;
          setTimeout(() => {
            if (!this.active) return;
            this.onresult?.({
              resultIndex: 0,
              results: Object.assign(
                [{ isFinal: false, 0: { transcript: "帮我检查一下登录接口的鉴权逻辑" } }],
                { length: 1 },
              ),
            });
          }, 80);
        }

        stop() {
          if (!this.active) return;
          this.active = false;
          this.onresult?.({
            resultIndex: 0,
            results: Object.assign(
              [{ isFinal: true, 0: { transcript: "帮我检查一下登录接口的鉴权逻辑" } }],
              { length: 1 },
            ),
          });
          this.onend?.();
        }

        abort() {
          this.active = false;
          this.onend?.();
        }
      }

      (window as any).SpeechRecognition = FakeSpeechRecognition;
      (window as any).webkitSpeechRecognition = FakeSpeechRecognition;
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/");

    const voiceBtn = page.getByRole("button", { name: "语音输入", exact: true }).first();
    await expect(voiceBtn).toBeVisible();
    await voiceBtn.click();

    await expect(page.getByText("正在聆听…")).toBeVisible();
    await expect(page.getByText("帮我检查一下登录接口的鉴权逻辑")).toBeVisible();
    await page.waitForTimeout(220);
    await page.screenshot({ path: shotPath(info, "voice-recording-1440.png"), fullPage: false });

    // Finish recording on desktop and verify transcript was inserted into composer textarea
    await page.getByRole("button", { name: "完成语音输入", exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "消息", exact: true }).first()).toHaveValue(
      "帮我检查一下登录接口的鉴权逻辑",
    );

    // Test mobile 390px: enter new-chat composer and verify voice strip + zero horizontal overflow
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(180);
    const mobileNewBtn = page.getByRole("button", { name: "新建", exact: true }).first();
    if (await mobileNewBtn.isVisible()) {
      await mobileNewBtn.click();
    }
    const mobileVoiceBtn = page.getByRole("button", { name: "语音输入", exact: true }).first();
    await expect(mobileVoiceBtn).toBeVisible();
    await mobileVoiceBtn.click();
    await expect(page.getByText("正在聆听…")).toBeVisible();
    await page.waitForTimeout(220);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
    ).toBe(true);
    await page.screenshot({ path: shotPath(info, "voice-recording-390.png"), fullPage: false });

    await page.getByRole("button", { name: "完成语音输入", exact: true }).first().click();
    await expect(page.getByRole("textbox", { name: "消息", exact: true }).first()).toHaveValue(
      /帮我检查一下登录接口的鉴权逻辑/,
    );
  });

  test("Settings -> 通用 -> 语音输入 configures Provider/Whisper mode and transcribes via Host", async ({
    page,
    request,
  }, info) => {
    const prior = await (await request.get("/api/app-settings")).json();
    try {
      let transcribeCalls = 0;
      await page.route("**/api/voice/status", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            providerAvailable: true,
            providers: [
              {
                providerId: "prov-openai",
                providerName: "codego",
                endpointId: "ep-1",
                protocol: "openai-responses",
                baseUrl: "https://codegoai.com/v1",
                hasCredential: true,
              },
            ],
            configuredProviderId: null,
            activeProviderId: "prov-openai",
            model: "whisper-1",
            engine: "auto",
            language: "auto",
            autoSend: false,
          }),
        });
      });

      await page.route("**/api/voice/transcribe*", async (route) => {
        transcribeCalls += 1;
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            text: "把导航栏改成极简黑白风格",
            providerId: "prov-openai",
            providerName: "codego",
            model: "gpt-4o-mini-transcribe",
            durationMs: 140,
          }),
        });
      });

      await page.addInitScript(() => {
        const fakeStream = { getTracks: () => [{ stop() {} }] };
        if (!navigator.mediaDevices) {
          Object.defineProperty(navigator, "mediaDevices", {
            value: {},
            configurable: true,
          });
        }
        navigator.mediaDevices.getUserMedia = async () => fakeStream as any;

        class FakeMediaRecorder {
          mimeType = "audio/webm";
          ondataavailable: ((e: any) => void) | null = null;
          onstop: (() => void) | null = null;
          static isTypeSupported() {
            return true;
          }
          start() {}
          stop() {
            this.ondataavailable?.({
              data: new Blob(["fake-audio-payload-bytes-123456"], { type: "audio/webm" }),
            });
            this.onstop?.();
          }
        }
        (window as any).MediaRecorder = FakeMediaRecorder;
      });

      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.getByRole("button", { name: "设置", exact: true }).click();
      await page
        .getByRole("navigation", { name: "配置导航", exact: true })
        .getByRole("button", { name: "通用", exact: true })
        .click();

      await expect(page.getByRole("heading", { name: "语音输入" })).toBeVisible();
      await page.getByLabel("识别方式", { exact: true }).selectOption("provider");
      await page.getByLabel("转写模型", { exact: true }).fill("gpt-4o-mini-transcribe");
      await page.getByRole("button", { name: "保存", exact: true }).click();
      await expect
        .poll(async () => (await (await request.get("/api/app-settings")).json()).voice.engine)
        .toBe("provider");

      await page.waitForTimeout(250);
      await page.screenshot({ path: shotPath(info, "voice-settings-1440.png"), fullPage: false });

      // Return to chat and record via Host provider transcription
      await page.getByRole("button", { name: "返回对话", exact: true }).click();
      await page.getByRole("button", { name: "语音输入", exact: true }).first().click();
      await expect(page.getByText("正在录音…")).toBeVisible();
      await page.getByRole("button", { name: "完成语音输入", exact: true }).first().click();

      await expect(page.getByRole("textbox", { name: "消息", exact: true }).first()).toHaveValue(
        "把导航栏改成极简黑白风格",
      );
      expect(transcribeCalls).toBe(1);
    } finally {
      const latest = await (await request.get("/api/app-settings")).json();
      await request.patch("/api/app-settings", {
        data: { ...prior, revision: latest.revision },
      });
    }
  });
});
