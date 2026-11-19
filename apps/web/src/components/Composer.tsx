import { shouldSend, useAppPreferences } from "../lib/preferences";
import { useEffect, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Clock,
  Pencil,
  Plus,
  Shield,
  Square,
  X,
} from "lucide-react";
import type {
  Command,
  HarnessBinding,
  HarnessDescriptor,
  InboxItem,
  Session,
} from "@kodo/protocol";
import { answerInteraction, changePendingMessage, stopSession } from "../lib/host-client";
import { HARNESS_NAMES } from "../lib/harnesses";
import { AttachmentButton, AttachmentList, useAttachments } from "./Attachments";
import {
  ComposerDropOverlay,
  MobileComposerPlusSheet,
  SlashTemplateMenu,
  useFileDropZone,
} from "./ComposerExtras";
import { HarnessBadge } from "./KodoBrand";
import { ModelControls } from "./ModelControls";
import { Modal } from "./Motion";
import { PermissionControls } from "./PermissionControls";
import { api } from "../lib/host-client";
import { appendVoiceTranscript, useVoiceInput } from "../lib/voice";
import { VoiceInputButton, VoiceRecordingBar } from "./VoiceInputControls";
import { NativeQuestions, nativeQuestions } from "./NativeQuestions";

type Wire = Record<string, any>;
type Action = (work: () => Promise<unknown>) => Promise<void>;

export function InteractionCard({ item, act }: { item: InboxItem; act: Action }) {
  const p = item.payload as Wire;
  const [answer, setAnswer] = useState("");
  const [custom, setCustom] = useState(false);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [parseError, setParseError] = useState("");
  const questions = nativeQuestions(p);
  const method = p.method ?? "";
  const approval =
    !questions &&
    (p.protocol === "claude" ||
      method.includes("requestApproval") ||
      method === "approval/request" ||
      p.type === "permission.asked");
  const management = p.protocol === "kodo";
  const request = p.params ?? {};
  const modeNames: Record<string, string> = {
    observe: "仅观察",
    notify: "结束时通知",
    continue: "自动继续",
    "create-only": "允许创建会话",
    "create-and-control": "允许创建并自动继续",
    revoke: "撤销未来授权",
  };

  const reply = async (value: unknown) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true);
    try {
      await act(() => answerInteraction(item.id, value));
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <div className="interaction" aria-busy={pending}>
      <div className="section-line interaction__header">
        <div className="interaction__header-left">
          <span className="interaction__icon" aria-hidden="true">
            <Shield size={14} />
          </span>
          <strong>
            {p.protocol === "kodo" ? "Kooyu 管理操作 · 等待确认" : "原生请求 · 等待你处理"}
          </strong>
        </div>
        <div className="interaction__header-right">
          <span className="interaction__protocol-tag">{p.protocol}</span>
        </div>
      </div>
      {management ? (
        <div className="detail-sub-stack interaction__management">
          <p>{request.action}</p>
          {(request.title || request.fromTitle || request.project) && (
            <p>{request.title ?? request.fromTitle ?? request.project}</p>
          )}
          {request.harnessId && (
            <p>
              交接到 {HARNESS_NAMES[request.harnessId as Session["harnessId"]] ?? request.harnessId}
            </p>
          )}
          {request.mode && <p>{modeNames[request.mode] ?? request.mode}</p>}
          {request.goal && <p>目标：{request.goal}</p>}
          {(request.limits?.maxContinuations ?? 0) > 0 && (
            <p>最多自动续聊 {request.limits.maxContinuations} 次</p>
          )}
          {(request.limits?.maxFailures ?? 0) > 0 && (
            <p>连续失败 {request.limits.maxFailures} 次后暂停</p>
          )}
          {(request.limits?.budgetUsd ?? 0) > 0 && <p>托管预算 ${request.limits.budgetUsd} USD</p>}
          {request.limits?.endAt && (
            <p>结束时间：{new Date(request.limits.endAt).toLocaleString()}</p>
          )}
          {request.text && <pre>{request.text}</pre>}
        </div>
      ) : questions ? (
        <NativeQuestions
          payload={p}
          questions={questions}
          reply={reply}
          disabled={pending}
          onToggleCustom={() => setCustom((v) => !v)}
          isCustom={custom}
        />
      ) : (
        <pre>{JSON.stringify(p.params ?? p.input ?? p, null, 2)}</pre>
      )}
      {!questions && (
        <div className="actions interaction__actions">
          {p.protocol === "acp" ? (
            <>
              {(p.options ?? []).map((o: Wire) => (
                <button
                  type="button"
                  key={o.optionId}
                  className="pill-action"
                  disabled={pending}
                  onClick={() => reply({ outcome: { outcome: "selected", optionId: o.optionId } })}
                >
                  {o.name}
                </button>
              ))}
              <button
                type="button"
                disabled={pending}
                onClick={() => void reply({ outcome: { outcome: "cancelled" } })}
              >
                取消请求
              </button>
            </>
          ) : approval ? (
            <>
              <button
                type="button"
                className="primary"
                disabled={pending}
                onClick={() =>
                  reply(
                    p.protocol === "claude"
                      ? { behavior: "allow" }
                      : p.protocol === "opencode"
                        ? { reply: "once" }
                        : p.protocol === "dsh"
                          ? { outcome: "allowed-once" }
                          : { decision: "accept" },
                  )
                }
              >
                允许本次
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  reply(
                    p.protocol === "claude"
                      ? { behavior: "deny" }
                      : p.protocol === "opencode"
                        ? { reply: "reject" }
                        : p.protocol === "dsh"
                          ? { outcome: "rejected" }
                          : { decision: "decline" },
                  )
                }
              >
                拒绝
              </button>
            </>
          ) : null}
          {!management && (
            <button
              type="button"
              className="quiet-btn interaction__json-toggle"
              disabled={pending}
              onClick={() => setCustom((v) => !v)}
            >
              结构化回答
            </button>
          )}
        </div>
      )}
      {custom && (
        <div className="interaction__custom">
          <label>
            <span className="interaction__custom-label">按原生请求字段填写 JSON</span>
            <textarea
              aria-label="原生回答 JSON"
              value={answer}
              aria-invalid={Boolean(parseError)}
              disabled={pending}
              onChange={(e) => {
                setAnswer(e.target.value);
                setParseError("");
              }}
              placeholder='{"answers": [...]}'
            />
          </label>
          {parseError && (
            <p className="interaction__error" role="alert">
              {parseError}
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={pending}
            onClick={() => {
              try {
                void reply(JSON.parse(answer));
              } catch {
                setParseError("JSON 格式无效，请检查引号、逗号和括号后重试。");
              }
            }}
          >
            提交回答
          </button>
        </div>
      )}
    </div>
  );
}

interface ComposerProps {
  session: Session;
  harnessDesc?: HarnessDescriptor;
  binding?: HarnessBinding;
  connected: boolean;
  busy: boolean;
  running: boolean;
  supervised?: boolean;
  compose: string;
  interactions: InboxItem[];
  unknownCommands: Command[];
  pendingCommands: Command[];
  onWithdraw: (commandId: string) => void;
  onCommandUpdate: (command: Command) => void;
  showScrollToBottom: boolean;
  onScrollToBottom: () => void;
  onComposeChange: (val: string) => void;
  onSubmit: (message: string, attachmentIds: string[]) => Promise<boolean>;
  onInspectNative: () => void;
  onError: (msg: string) => void;
  act: Action;
}

export function Composer({
  session,
  harnessDesc,
  binding,
  connected,
  busy,
  running,
  supervised = false,
  compose,
  interactions,
  unknownCommands,
  pendingCommands,
  onWithdraw,
  onCommandUpdate,
  showScrollToBottom,
  onScrollToBottom,
  onComposeChange,
  onSubmit,
  onInspectNative,
  onError,
  act,
}: ComposerProps) {
  const { settings: preferences } = useAppPreferences();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const attachments = useAttachments(session.id, session.id);
  const [stopping, setStopping] = useState(false);
  const stoppingRef = useRef(false);
  const [stopNotice, setStopNotice] = useState("");
  const [stopSheetOpen, setStopSheetOpen] = useState(false);
  const [plusSheetOpen, setPlusSheetOpen] = useState(false);
  const supportsSteer =
    (session.nativeCapabilities?.steer ?? harnessDesc?.capabilities.steer) === "supported";
  const canSend = connected && !session.bindingUnavailable;
  const dropZone = useFileDropZone(canSend && !busy, (files) => void attachments.add(files));

  const stop = async (pause: boolean) => {
    if (stoppingRef.current) return;
    stoppingRef.current = true;
    setStopping(true);
    setStopNotice("");
    try {
      // Cancellation must remain available while a send or another mutation is awaiting IO.
      const result = await stopSession(session.id, pause);
      if (result.cancel === "requested; await native event")
        setStopNotice(pause ? "托管已暂停，已请求中断当前回合。" : "已请求中断当前回合。");
      else if (result.cancel === "not running; native execution settled")
        setStopNotice(pause ? "托管已暂停，当前回合已结束。" : "当前回合已结束。");
      else if (result.cancel === "not delivered: native connection offline")
        setStopNotice(
          pause
            ? "托管已暂停；原生连接未建立，停止请求未递送。"
            : "原生连接未建立，停止请求未递送。",
        );
      else if (result.status === "paused")
        setStopNotice(`托管已暂停；当前回合的中断结果尚未确认：${result.cancel}`);
      else onError(result.cancel);
    } catch (error) {
      onError(error instanceof Error ? error.message : "停止失败，请重试。");
    } finally {
      stoppingRef.current = false;
      setStopping(false);
    }
  };

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(54, Math.min(el.scrollHeight, 220))}px`;
  }, [compose]);

  const submitMessage = (overrideText?: string) => {
    const textToSend = overrideText ?? compose;
    const ids = attachments.readyIds;
    if ((!textToSend.trim() && !ids.length) || !canSend || busy || attachments.uploading) return;
    if (attachments.failed) {
      attachments.setError("有附件上传失败，请移除后再发送。");
      return;
    }
    void onSubmit(textToSend, ids).then((accepted) => {
      if (accepted) attachments.clear();
    });
  };

  const composeRef = useRef(compose);
  composeRef.current = compose;
  const voice = useVoiceInput({
    disabled: session.bindingUnavailable || busy,
    onTranscript: (spoken) => {
      const merged = appendVoiceTranscript(composeRef.current, spoken);
      composeRef.current = merged;
      onComposeChange(merged);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    onAutoSend: () => {
      const merged = composeRef.current;
      if (merged.trim()) submitMessage(merged);
    },
  });

  const showStopButton =
    (running ||
      supervised ||
      (session.runState === "unknown" && session.connectionState === "connected")) &&
    !compose.trim() &&
    !attachments.attachments.length;
  const cancelUnsupported = harnessDesc?.capabilities.cancel === "unsupported";
  const permissionsNode = (
    <PermissionControls
      key={`permissions:${session.id}`}
      harnessId={session.harnessId}
      nativePermission={harnessDesc?.nativeDefaults?.permission}
      value={session.permissionMode ?? null}
      sessionId={session.id}
      nativeSessionId={session.nativeSessionId}
      connected={session.connectionState === "connected"}
      disabled={busy || !canSend}
      onChange={async (permissionMode) => {
        await api(`/sessions/${session.id}`, "PATCH", { permissionMode });
        await act(async () => {});
      }}
    />
  );

  return (
    <div className="composer-area" {...dropZone.handlers}>
      <ComposerDropOverlay active={dropZone.dragOver} label="松开以上传文件到当前对话" />
      {showScrollToBottom && (
        <div className="scroll-bottom-wrap">
          <button
            type="button"
            className="scroll-bottom-pill"
            onClick={onScrollToBottom}
            aria-label="回到底部"
          >
            <ArrowDown size={14} />
            <span>最新消息</span>
          </button>
        </div>
      )}

      {interactions.map((i) => (
        <InteractionCard key={i.id} item={i} act={act} />
      ))}

      {unknownCommands.map((c) => (
        <div key={c.id} className="notice">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>发送状态待核对</span>
          <button type="button" onClick={onInspectNative}>
            读取原生状态
          </button>
        </div>
      ))}
      {session.bindingUnavailable && (
        <div className="notice" role="status">
          <AlertTriangle size={15} aria-hidden="true" />
          <span>模型配置已失效</span>
        </div>
      )}

      {pendingCommands.length > 0 && (
        <div className="pending-messages" aria-label="待发消息">
          <div className="pending-messages__head">
            <span className="pending-messages__title">
              <Clock size={12} aria-hidden="true" />
              <span>待发队列 · {pendingCommands.length}</span>
            </span>
          </div>
          <div className="pending-messages__list">
            {pendingCommands.map((c, idx) => (
              <PendingMessage
                key={c.id}
                index={idx}
                command={c}
                session={session}
                disabled={busy || !connected}
                supportsSteer={supportsSteer}
                act={act}
                onWithdraw={onWithdraw}
                onUpdated={onCommandUpdate}
              />
            ))}
          </div>
        </div>
      )}

      <div
        className="composer"
        onPointerMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
          e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
        }}
      >
        <SlashTemplateMenu
          compose={compose}
          onSelect={(text) => {
            onComposeChange(text);
            requestAnimationFrame(() => textareaRef.current?.focus());
          }}
        />
        <AttachmentList
          attachments={attachments.attachments}
          error={attachments.error}
          disabled={busy || !canSend}
          onRemove={attachments.remove}
        />
        <VoiceRecordingBar voice={voice} />
        <textarea
          ref={textareaRef}
          rows={2}
          aria-label="消息"
          placeholder={
            session.bindingUnavailable
              ? "会话不可用"
              : connected
                ? HARNESS_NAMES[session.harnessId] || "Kooyu"
                : "Host 未连接"
          }
          title="支持输入 / 调出快捷任务模板，或拖拽文件到此上传"
          value={compose}
          onChange={(e) => onComposeChange(e.target.value)}
          disabled={session.bindingUnavailable}
          onKeyDown={(e) => {
            if (shouldSend(e, preferences.sendShortcut)) {
              e.preventDefault();
              submitMessage();
            }
          }}
        />
        <div className="composer-toolbar">
          <button
            type="button"
            className="composer-mobile-plus mobile-only"
            aria-label="添加附件、权限或模板"
            disabled={busy || !canSend}
            onClick={() => setPlusSheetOpen(true)}
          >
            <Plus size={19} />
          </button>
          <div className="composer-pickers desktop-only-flex">
            <AttachmentButton
              loading={false}
              disabled={busy || !canSend}
              onAdd={(files) => void attachments.add(files)}
            />
            <span className="composer-harness">
              <HarnessBadge harnessId={session.harnessId} size="xs" shape="circle" tone="mono" />
              <span className="composer-harness__name">{HARNESS_NAMES[session.harnessId]}</span>
            </span>
            {permissionsNode}
          </div>
          <div className="composer-actions-right">
            <div className="composer-mobile-chips">
              <ModelControls
                key={session.id}
                session={session}
                binding={binding}
                modelSupport={harnessDesc?.modelSupport}
                nativeDefaults={harnessDesc?.nativeDefaults}
                disabled={busy || !canSend}
                act={act}
              />
              <span className="mobile-only-inline composer-mobile-perm">
                <PermissionControls
                  key={`mobile-perm:${session.id}`}
                  ariaLabel="工具权限"
                  harnessId={session.harnessId}
                  nativePermission={harnessDesc?.nativeDefaults?.permission}
                  value={session.permissionMode ?? null}
                  sessionId={session.id}
                  nativeSessionId={session.nativeSessionId}
                  connected={session.connectionState === "connected"}
                  disabled={busy || !canSend}
                  onChange={async (permissionMode) => {
                    await api(`/sessions/${session.id}`, "PATCH", { permissionMode });
                    await act(async () => {});
                  }}
                />
              </span>
            </div>
            <VoiceInputButton voice={voice} disabled={session.bindingUnavailable || busy} />
            {showStopButton ? (
              <button
                type="button"
                className="send-button send-button--stop"
                aria-label={supervised ? "停止或暂停托管" : "中断当前回合"}
                title={
                  !supervised && cancelUnsupported
                    ? "此 harness 不支持中断单轮"
                    : supervised
                      ? "停止运行或暂停自动托管"
                      : "中断当前回合"
                }
                disabled={stopping || !connected || (!supervised && cancelUnsupported)}
                onClick={() => {
                  if (supervised) setStopSheetOpen(true);
                  else void stop(false);
                }}
              >
                <Square size={13} fill="currentColor" />
              </button>
            ) : (
              <button
                type="button"
                className="send-button"
                aria-label="发送消息"
                disabled={
                  (!compose.trim() && !attachments.readyIds.length) ||
                  !canSend ||
                  busy ||
                  attachments.uploading
                }
                onClick={() => submitMessage()}
              >
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      {stopNotice && (
        <div className="composer-foot" role="status">
          <span>{stopNotice}</span>
        </div>
      )}

      {stopSheetOpen && (
        <Modal
          title="停止当前运行"
          subtitle="此对话已开启自动托管；请选择仅中断本轮或同时暂停托管"
          onClose={() => setStopSheetOpen(false)}
        >
          <div className="ios-inset-group action-sheet-group">
            <button
              type="button"
              className="ios-sheet-action-row is-destructive"
              disabled={stopping || !connected}
              onClick={() => {
                setStopSheetOpen(false);
                void stop(true);
              }}
            >
              <span>停止并暂停托管（推荐）</span>
            </button>
            <button
              type="button"
              className="ios-sheet-action-row"
              disabled={stopping || !connected || cancelUnsupported}
              onClick={() => {
                setStopSheetOpen(false);
                void stop(false);
              }}
            >
              <span>仅中断本轮（保留托管）</span>
            </button>
            <button
              type="button"
              className="ios-sheet-action-row is-cancel"
              onClick={() => setStopSheetOpen(false)}
            >
              <span>取消</span>
            </button>
          </div>
        </Modal>
      )}

      <MobileComposerPlusSheet
        open={plusSheetOpen}
        onClose={() => setPlusSheetOpen(false)}
        disabled={busy || !canSend}
        onAddFiles={(files) => void attachments.add(files)}
        permissionsNode={permissionsNode}
        onSelectTemplate={(text) => {
          onComposeChange(text);
          requestAnimationFrame(() => textareaRef.current?.focus());
        }}
      />
    </div>
  );
}

function PendingMessage({
  index,
  command,
  session,
  disabled,
  supportsSteer,
  act,
  onWithdraw,
  onUpdated,
}: {
  index: number;
  command: Command;
  session: Session;
  disabled: boolean;
  supportsSteer: boolean;
  act: Action;
  onWithdraw: (id: string) => void;
  onUpdated: (command: Command) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const immediate =
    session.runState === "idle" || (session.runState === "running" && supportsSteer);
  const badgeKind =
    command.body.mode === "steer" ? "steer" : command.body.sendNow ? "now" : "queue";
  const badgeLabel =
    badgeKind === "steer" ? "引导" : badgeKind === "now" ? "优先" : `排队 ${index + 1}`;
  const promoteTitle =
    session.runState === "running"
      ? supportsSteer
        ? "立即引导当前回合，沿用当前模型"
        : "此 harness 不支持运行中插话"
      : "优先递送这条消息";

  const change = (action: "edit" | "send-now") =>
    void act(async () => {
      const result = await changePendingMessage(
        session.id,
        command,
        action,
        editing ? text : undefined,
      );
      onUpdated(result);
      setEditing(false);
    });

  return (
    <div className="pending-message" data-command-id={command.id}>
      {editing ? (
        <div className="pending-message__editor">
          <label className="pending-message__edit-label">
            <span className="sr-only">修改待发消息内容</span>
            <textarea
              aria-label="修改待发消息内容"
              rows={2}
              value={text}
              disabled={disabled}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <div className="pending-message__edit-foot">
            <div className="pending-message__actions">
              <button
                type="button"
                className="pending-promote-btn"
                disabled={disabled || !immediate || !text.trim()}
                title={promoteTitle}
                onClick={() => change("send-now")}
              >
                <ArrowUp size={12} aria-hidden="true" />
                <span>{session.runState === "running" ? "引导当前轮" : "立即发送"}</span>
              </button>
              <button
                type="button"
                className="pending-text-btn pending-text-btn--danger"
                disabled={disabled}
                onClick={() => onWithdraw(command.id)}
              >
                撤回待发消息
              </button>
            </div>
            <div className="pending-message__actions">
              <button
                type="button"
                className="pending-text-btn"
                disabled={disabled}
                onClick={() => setEditing(false)}
              >
                取消修改
              </button>
              <button
                type="button"
                className="pending-save-btn"
                disabled={disabled || !text.trim()}
                onClick={() => change("edit")}
              >
                保存修改
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="pending-message__row">
          <span className={`pending-message__badge is-${badgeKind}`}>{badgeLabel}</span>
          <p className="pending-message__text">{String(command.body.text)}</p>
          <div className="pending-message__actions">
            <button
              type="button"
              className="pending-icon-btn"
              disabled={disabled}
              aria-label="修改待发消息"
              title="修改待发消息"
              onClick={() => {
                setText(String(command.body.text));
                setEditing(true);
              }}
            >
              <Pencil size={13} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="pending-promote-btn"
              disabled={disabled || !immediate}
              aria-label={session.runState === "running" ? "引导当前轮" : "立即发送"}
              title={promoteTitle}
              onClick={() => change("send-now")}
            >
              <ArrowUp size={12} aria-hidden="true" />
              <span aria-hidden="true">
                {session.runState === "running" ? "引导当前轮" : "立即发送"}
              </span>
            </button>
            <button
              type="button"
              className="pending-icon-btn pending-icon-btn--danger"
              disabled={disabled}
              aria-label="撤回待发消息"
              title="撤回待发消息"
              onClick={() => onWithdraw(command.id)}
            >
              <X size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
