import { shouldSend, useAppPreferences } from "../lib/preferences";
import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, AlertTriangle, Clock, Pencil, Shield, Square, X } from "lucide-react";
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
import { HarnessBadge } from "./KodoBrand";
import { ModelControls } from "./ModelControls";
import { PermissionControls } from "./PermissionControls";
import { api } from "../lib/host-client";
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

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(54, Math.min(el.scrollHeight, 220))}px`;
  }, [compose]);

  const supportsSteer =
    (session.nativeCapabilities?.steer ?? harnessDesc?.capabilities.steer) === "supported";
  const canSend = connected && !session.bindingUnavailable;
  const submitMessage = () => {
    const ids = attachments.readyIds;
    if ((!compose.trim() && !ids.length) || !canSend || busy || attachments.uploading) return;
    if (attachments.failed) {
      attachments.setError("有附件上传失败，请移除后再发送。");
      return;
    }
    void onSubmit(compose, ids).then((accepted) => {
      if (accepted) attachments.clear();
    });
  };

  return (
    <div className="composer-area">
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
        <AttachmentList
          attachments={attachments.attachments}
          error={attachments.error}
          disabled={busy || !canSend}
          onRemove={attachments.remove}
        />
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
          <div className="composer-pickers">
            <AttachmentButton
              loading={false}
              disabled={busy || !canSend}
              onAdd={(files) => void attachments.add(files)}
            />
            <span className="composer-harness">
              <HarnessBadge harnessId={session.harnessId} size="xs" shape="circle" tone="mono" />
              <span className="composer-harness__name">{HARNESS_NAMES[session.harnessId]}</span>
            </span>
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
          </div>
          <div className="composer-actions-right">
            <ModelControls
              key={session.id}
              session={session}
              binding={binding}
              modelSupport={harnessDesc?.modelSupport}
              nativeDefaults={harnessDesc?.nativeDefaults}
              disabled={busy || !canSend}
              act={act}
            />
            {session.runState === "running" &&
            !compose.trim() &&
            !attachments.attachments.length ? (
              <button
                type="button"
                className="send-button send-button--stop"
                aria-label="中断当前回合"
                title={
                  harnessDesc?.capabilities.cancel === "unsupported"
                    ? "此 harness 不支持中断单轮"
                    : "中断当前回合"
                }
                disabled={
                  stopping || !connected || harnessDesc?.capabilities.cancel === "unsupported"
                }
                onClick={() => {
                  setStopping(true);
                  void stopSession(session.id, false)
                    .then((r) => {
                      if (r.cancel !== "requested; await native event") onError(r.cancel);
                    })
                    .catch((e) => onError(e instanceof Error ? e.message : "中断失败"))
                    .finally(() => setStopping(false));
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
                onClick={submitMessage}
              >
                <ArrowUp size={17} strokeWidth={2.4} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="composer-foot">
        <button
          type="button"
          className="stop-button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const r = await stopSession(session.id, true);
              if (r.cancel !== "requested; await native event") onError(r.cancel);
            })
          }
        >
          <Square size={10} fill="currentColor" />
          <span>停止并暂停托管</span>
        </button>
      </div>
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
