import type { ReactNode } from "react";
import { Check, ChevronDown, Cpu, Gauge, RefreshCw, Search } from "lucide-react";
import type { HarnessId, HarnessModelOption, HarnessModelSupport } from "@kodo/protocol";
import { IosPopover } from "./IosPopover";
import { ModelParameters } from "./ModelParameters";
import { ReasoningSlider } from "./ReasoningSlider";

export type ComposerModelChoiceItem = {
  key: string;
  title: string;
  subtitle?: string;
  selected: boolean;
  dataValue?: string;
  accent?: boolean;
  disabled?: boolean;
  onSelect: () => void;
};

export function ComposerModelControls({
  harnessId,
  modelSupport,
  disabled = false,
  modelOpen,
  onModelOpenChange,
  reasoningOpen,
  onReasoningOpenChange,
  modelLabel,
  modelTitle,
  modelDataValue,
  searchAriaLabel,
  searchQuery,
  onSearchQueryChange,
  showSearch = true,
  loading = false,
  refreshDisabled = false,
  onRefresh,
  emptyText = "暂无可用模型",
  onRetry,
  topSlot,
  topItems,
  bindingItems = [],
  modelItems,
  customItem,
  optionRole,
  parametersModel,
  error,
  popoverAriaLabel,
  reasoningLevels,
  reasoningValue,
  reasoningDefault,
  reasoningDisabled = false,
  reasoningSliderLabel,
  onReasoningChange,
  onReasoningCommit,
}: {
  harnessId: HarnessId;
  modelSupport: HarnessModelSupport;
  disabled?: boolean;
  modelOpen: boolean;
  onModelOpenChange: (open: boolean) => void;
  reasoningOpen: boolean;
  onReasoningOpenChange: (open: boolean) => void;
  modelLabel: string;
  modelTitle?: string;
  modelDataValue?: string;
  searchAriaLabel: string;
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  showSearch?: boolean;
  loading?: boolean;
  refreshDisabled?: boolean;
  onRefresh?: () => void;
  emptyText?: string;
  onRetry?: () => void;
  topSlot?: ReactNode;
  topItems: ComposerModelChoiceItem[];
  bindingItems?: ComposerModelChoiceItem[];
  modelItems: ComposerModelChoiceItem[];
  customItem?: ComposerModelChoiceItem | null;
  optionRole?: "option";
  parametersModel?: HarnessModelOption;
  error?: string;
  popoverAriaLabel: string;
  reasoningLevels: string[];
  reasoningValue: string;
  /** The harness's own configured level, shown instead of a generic "default". */
  reasoningDefault?: string;
  reasoningDisabled?: boolean;
  reasoningSliderLabel: string;
  onReasoningChange: (value: string) => void;
  onReasoningCommit?: (value: string) => void;
}) {
  const placeholder =
    harnessId === "kodo" || harnessId === "pi"
      ? "筛选或输入 provider/model…"
      : "筛选或输入模型 ID…";

  const renderChoice = (item: ComposerModelChoiceItem, showDefaultIcon = false) => {
    const ariaProps =
      optionRole === "option"
        ? { role: "option" as const, "aria-selected": item.selected }
        : { "aria-pressed": item.selected };
    return (
      <button
        type="button"
        key={item.key}
        data-value={item.dataValue}
        disabled={item.disabled}
        className={`ios-menu__item ${item.selected ? "is-selected" : ""} ${
          item.accent ? "ios-menu__item--accent" : ""
        }`}
        onClick={item.onSelect}
        {...ariaProps}
      >
        {showDefaultIcon && <Cpu size={13} className="ios-menu__icon" aria-hidden="true" />}
        {item.subtitle ? (
          <div className="ios-menu__text-col">
            <span className="ios-menu__title">{item.title}</span>
            <span className="ios-menu__sub">{item.subtitle}</span>
          </div>
        ) : (
          <span className="ios-menu__title">{item.title}</span>
        )}
        {item.selected && <Check size={14} className="ios-menu__check" />}
      </button>
    );
  };

  const isEmpty =
    !loading &&
    showSearch &&
    modelItems.length === 0 &&
    bindingItems.length === 0 &&
    !searchQuery.trim();

  return (
    <>
      {modelSupport === "native-only" ? (
        <button
          type="button"
          aria-label="模型配置"
          disabled
          className="composer-pill-btn composer-pill-btn--ghost composer-model-button is-disabled"
          title="该引擎使用其原生配置决定模型，不支持会话覆盖"
        >
          <Cpu size={13} className="composer-model-button__icon" aria-hidden="true" />
          <span className="composer-model-button__label">原生默认</span>
        </button>
      ) : (
        <IosPopover
          open={modelOpen}
          onOpenChange={onModelOpenChange}
          side="top"
          align="end"
          wide
          role="dialog"
          trigger={(props) => (
            <button
              {...props}
              type="button"
              disabled={disabled}
              data-value={modelDataValue}
              className="composer-pill-btn composer-pill-btn--ghost composer-model-button"
              aria-label="模型配置"
              title={modelTitle || modelLabel}
            >
              <Cpu size={13} className="composer-model-button__icon" aria-hidden="true" />
              <span className="composer-model-button__label">{modelLabel}</span>
              <ChevronDown size={12} className="composer-pill-chevron" aria-hidden="true" />
            </button>
          )}
        >
          <div className="ms-popover" aria-label={popoverAriaLabel}>
            {showSearch && (
              <div className="ms-search-row">
                <div className="ios-menu__search ms-search">
                  <Search size={13} aria-hidden="true" />
                  <input
                    aria-label={searchAriaLabel}
                    placeholder={placeholder}
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                  />
                </div>
                {onRefresh && (
                  <button
                    type="button"
                    className="ms-refresh-btn"
                    disabled={refreshDisabled}
                    onClick={onRefresh}
                    aria-label="刷新模型"
                    title="刷新"
                  >
                    <RefreshCw size={12} className={loading ? "spin" : ""} aria-hidden="true" />
                  </button>
                )}
              </div>
            )}

            {topSlot}

            <div className="ios-menu__scroll ms-model-scroll">
              {loading && modelItems.length === 0 && bindingItems.length === 0 && (
                <div className="ms-empty" role="status">
                  正在读取原生模型…
                </div>
              )}
              {isEmpty && (
                <div className="ms-empty" role="status">
                  <span>{emptyText}</span>
                  {onRetry && (
                    <button type="button" onClick={onRetry}>
                      重试
                    </button>
                  )}
                </div>
              )}
              {customItem && renderChoice(customItem, true)}
              {topItems.map((item) => renderChoice(item))}
              {bindingItems.length > 0 && (
                <>
                  <div className="ios-menu__divider" />
                  <div className="ios-menu__section-label">Harness 绑定</div>
                  {bindingItems.map((item) => renderChoice(item))}
                </>
              )}
              {modelItems.length > 0 && (
                <>
                  {(topItems.length > 0 || bindingItems.length > 0) && (
                    <div className="ios-menu__divider" />
                  )}
                  <div className="ios-menu__section-label">可用模型</div>
                  {modelItems.map((item) => renderChoice(item))}
                </>
              )}
            </div>

            <div className="ios-menu__divider" />
            <ModelParameters model={parametersModel} />
            {error && (
              <p role="alert" className="ms-error">
                {error}
              </p>
            )}
          </div>
        </IosPopover>
      )}

      <IosPopover
        open={reasoningOpen}
        onOpenChange={onReasoningOpenChange}
        side="top"
        align="end"
        role="dialog"
        trigger={(props) => (
          <button
            {...props}
            type="button"
            disabled={disabled}
            className={`composer-pill-btn composer-pill-btn--ghost composer-reasoning-button ${
              reasoningLevels.length === 0 ? "is-muted" : ""
            }`}
            aria-label="思考强度"
            title={
              reasoningValue
                ? `思考强度：${reasoningValue}`
                : reasoningDefault
                  ? `思考强度：原生配置 ${reasoningDefault}`
                  : "思考强度：沿用原生配置"
            }
          >
            <Gauge size={13} className="composer-reasoning-button__icon" aria-hidden="true" />
            <span className="composer-reasoning-button__label">
              {reasoningValue || reasoningDefault || "默认思考"}
            </span>
            <ChevronDown size={12} className="composer-pill-chevron" aria-hidden="true" />
          </button>
        )}
      >
        <div className="ms-popover ms-popover--reasoning">
          <ReasoningSlider
            levels={reasoningLevels}
            value={reasoningValue}
            disabled={reasoningDisabled}
            label={reasoningSliderLabel}
            onChange={onReasoningChange}
            onCommit={onReasoningCommit}
          />
          {error && (
            <p role="alert" className="ms-error">
              {error}
            </p>
          )}
        </div>
      </IosPopover>
    </>
  );
}
