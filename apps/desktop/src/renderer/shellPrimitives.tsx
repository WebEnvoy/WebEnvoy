import * as Tabs from "@radix-ui/react-tabs";
import {
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from "lucide-react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type FocusAreaName = "left-panel" | "thread-workspace" | "right-panel" | "bottom-panel";
type ResizeEdge = "top" | "right" | "bottom" | "left";
type PointerPoint = { x: number; y: number };
type ResizeDragState = { didMove: boolean; startPosition: number; startSize: number };
type ShellPanelControls = { left: ReactNode; right: ReactNode; rightFullscreen: ReactNode };

const LEFT_PANEL_DEFAULT_WIDTH = 300;
const LEFT_PANEL_MIN_WIDTH = 240;
const LEFT_PANEL_MAX_WIDTH = 520;
const FLOATING_LEFT_PANEL_EXIT_MS = 500;
const PANEL_COLLAPSE_SCALE = 0.5;
const LEFT_PANEL_COLLAPSE_WIDTH = LEFT_PANEL_MIN_WIDTH * PANEL_COLLAPSE_SCALE;
const LEFT_PANEL_WIDTH_KEY = "webenvoy.shell.v3.left-panel-width";
const RIGHT_PANEL_DEFAULT_WIDTH = 600;
const RIGHT_PANEL_MIN_WIDTH = 320;
const RIGHT_PANEL_RESERVED_WIDTH = 352;
const RIGHT_PANEL_COLLAPSE_WIDTH = RIGHT_PANEL_MIN_WIDTH * PANEL_COLLAPSE_SCALE;
const RIGHT_PANEL_WIDTH_KEY = "webenvoy.shell.v3.right-panel-width";
const RIGHT_PANEL_RATIO_KEY = "webenvoy.shell.v3.right-panel-ratio";
const RIGHT_PANEL_OPEN_KEY_PREFIX = "webenvoy.shell.v3.right-panel-open:";
const NARROW_RIGHT_PANEL_MAX_RATIO = 0.42;
const PANEL_ANIMATION_DURATION_MS = 500;
const workspaceScrollPositions = new Map<string, number>();

type AppShellProps = {
  collapsePanelsOnNarrow?: boolean;
  initialRightOpen?: boolean;
  left: ReactNode;
  header: (panelControls: ShellPanelControls) => ReactNode;
  workspace: ReactNode;
  right: ReactNode | null;
  rightPanelCloseRequestKey?: number;
  rightPanelOpenRequestKey?: number;
  rightPanelStateKey?: string;
};

export function AppShell({ collapsePanelsOnNarrow = false, initialRightOpen = false, left, header, workspace, right, rightPanelCloseRequestKey, rightPanelOpenRequestKey, rightPanelStateKey }: AppShellProps) {
  const [isLeftOpen, setLeftOpen] = useState(true);
  const [isRightOpen, setRightOpen] = useState(initialRightOpen);
  const [isLeftPreviewOpen, setLeftPreviewOpen] = useState(false);
  const [isLeftPreviewRendered, setLeftPreviewRendered] = useState(false);
  const [isRightFullscreen, setRightFullscreen] = useState(false);
  const [leftWidth, setLeftWidth] = useState(() =>
    readStoredPanelWidth(
      LEFT_PANEL_WIDTH_KEY,
      LEFT_PANEL_DEFAULT_WIDTH,
      LEFT_PANEL_MIN_WIDTH,
      LEFT_PANEL_MAX_WIDTH,
    ),
  );
  const [rightWidth, setRightWidth] = useState(() =>
    readStoredPanelWidth(
      RIGHT_PANEL_WIDTH_KEY,
      RIGHT_PANEL_DEFAULT_WIDTH,
      RIGHT_PANEL_MIN_WIDTH,
      RIGHT_PANEL_DEFAULT_WIDTH,
    ),
  );
  const [rightWidthRatio, setRightWidthRatio] = useState(() =>
    readStoredPanelRatio(RIGHT_PANEL_RATIO_KEY),
  );
  const [contentRegionWidth, setContentRegionWidth] = useState(0);
  const [activeFocusArea, setActiveFocusArea] = useState<FocusAreaName>("thread-workspace");
  const [hoveredFocusArea, setHoveredFocusArea] = useState<FocusAreaName>("thread-workspace");
  const contentRegionBodyRef = useRef<HTMLDivElement | null>(null);
  const leftPreviewExitTimerRef = useRef<number | null>(null);
  const handledRightPanelOpenRequestKeyRef = useRef<number | undefined>(undefined);
  const handledRightPanelCloseRequestKeyRef = useRef<number | undefined>(undefined);
  const rightPanelFocusRequestPendingRef = useRef(false);
  const rightPanelReturnFocusRef = useRef<HTMLElement | null>(null);
  const rightPanelStateKeyRef = useRef(rightPanelStateKey);
  const rightPanelStatesRef = useRef(new Map<string, boolean>());
  const hasRightPanel = right != null;
  const isVeryNarrow = collapsePanelsOnNarrow
    && typeof window !== "undefined"
    && window.matchMedia("(max-width: 720px)").matches;
  const isRightPanelFullscreen = isRightFullscreen || (isRightOpen && isVeryNarrow);
  const rightPanelMaxWidth = getResponsiveRightPanelMaxWidth(
    contentRegionWidth,
    isRightPanelFullscreen,
    collapsePanelsOnNarrow,
  );
  const resolvedRightPanelRatio =
    rightWidthRatio ?? widthToRightPanelWidthRatio(RIGHT_PANEL_DEFAULT_WIDTH, contentRegionWidth);
  const effectiveRightWidth =
    contentRegionWidth > 0
      ? rightPanelWidthRatioToPixels(resolvedRightPanelRatio, contentRegionWidth)
      : rightWidth;
  const fullscreenRightWidth = getAvailableRightPanelWidth(contentRegionWidth, true);
  const visibleRightWidth = isRightPanelFullscreen
    ? fullscreenRightWidth
    : Math.min(effectiveRightWidth, rightPanelMaxWidth);
  const rightPanelAnimation = usePanelAnimation(isRightOpen);
  const renderedRightWidth = Math.max(0, Math.min(1, rightPanelAnimation.progress)) * visibleRightWidth;

  const setRightPanelOpen = useCallback((open: boolean) => {
    const stateKey = rightPanelStateKeyRef.current;
    if (stateKey != null) {
      rightPanelStatesRef.current.set(stateKey, open);
      writeStoredRightPanelState(stateKey, open);
    }
    setRightOpen(open);
  }, []);

  const moveFocusBeforeRightPanelCollapse = useCallback(() => {
    moveFocusBeforePanelCollapse(
      "right-panel",
      '[data-workbench-open-right], [data-shell-panel-toggle="right"]',
      rightPanelReturnFocusRef.current,
    );
  }, []);

  useEffect(() => {
    rightPanelStateKeyRef.current = rightPanelStateKey;
    rightPanelReturnFocusRef.current = null;
    setRightOpen(
      rightPanelStateKey == null
        ? initialRightOpen
        : rememberedRightPanelState(rightPanelStatesRef.current, rightPanelStateKey, initialRightOpen),
    );
    setRightFullscreen(false);
  }, [initialRightOpen, rightPanelStateKey]);

  useEffect(() => {
    const element = contentRegionBodyRef.current;
    if (element == null) {
      return;
    }

    let frame = 0;
    const observer = new ResizeObserver(([entry]) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setContentRegionWidth(entry.contentRect.width);
      });
    });
    observer.observe(element);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (isLeftOpen) {
      if (leftPreviewExitTimerRef.current != null) {
        window.clearTimeout(leftPreviewExitTimerRef.current);
        leftPreviewExitTimerRef.current = null;
      }
      setLeftPreviewOpen(false);
      setLeftPreviewRendered(false);
    }
  }, [isLeftOpen]);

  useEffect(() => {
    if (!isRightOpen || !hasRightPanel) {
      setRightFullscreen(false);
    }
  }, [hasRightPanel, isRightOpen]);

  useEffect(() => {
    if (!hasRightPanel || rightPanelOpenRequestKey == null || handledRightPanelOpenRequestKeyRef.current === rightPanelOpenRequestKey) return;
    handledRightPanelOpenRequestKeyRef.current = rightPanelOpenRequestKey;
    rightPanelReturnFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    rightPanelFocusRequestPendingRef.current = true;
    if (isRightOpen) {
      const frame = window.requestAnimationFrame(() => {
        rightPanelFocusRequestPendingRef.current = false;
        document.querySelector<HTMLElement>('[data-focus-area="right-panel"][tabindex]')?.focus();
      });
      return () => window.cancelAnimationFrame(frame);
    }
    setRightPanelOpen(true);
  }, [hasRightPanel, isRightOpen, rightPanelOpenRequestKey, setRightPanelOpen]);

  useLayoutEffect(() => {
    if (!hasRightPanel || !isRightOpen || !rightPanelFocusRequestPendingRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      rightPanelFocusRequestPendingRef.current = false;
      document.querySelector<HTMLElement>('[data-focus-area="right-panel"][tabindex]')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [hasRightPanel, isRightOpen]);

  useEffect(() => {
    if (rightPanelCloseRequestKey == null || handledRightPanelCloseRequestKeyRef.current === rightPanelCloseRequestKey) return;
    handledRightPanelCloseRequestKeyRef.current = rightPanelCloseRequestKey;
    moveFocusBeforeRightPanelCollapse();
    setRightPanelOpen(false);
  }, [moveFocusBeforeRightPanelCollapse, rightPanelCloseRequestKey, setRightPanelOpen]);

  useEffect(() => {
    if (!collapsePanelsOnNarrow) return;
    const narrowWindow = window.matchMedia("(max-width: 960px)");
    const veryNarrowWindow = window.matchMedia("(max-width: 720px)");
    const syncPanels = () => {
      if (narrowWindow.matches) {
        moveFocusBeforePanelCollapse("left-panel", '[data-shell-panel-toggle="left"]');
        setLeftOpen(false);
      }
      if (veryNarrowWindow.matches) {
        moveFocusBeforeRightPanelCollapse();
        setRightOpen(false);
      } else {
        const stateKey = rightPanelStateKeyRef.current;
        setRightOpen(
          stateKey == null
            ? initialRightOpen
            : rememberedRightPanelState(rightPanelStatesRef.current, stateKey, initialRightOpen),
        );
      }
    };
    syncPanels();
    narrowWindow.addEventListener("change", syncPanels);
    veryNarrowWindow.addEventListener("change", syncPanels);
    return () => {
      narrowWindow.removeEventListener("change", syncPanels);
      veryNarrowWindow.removeEventListener("change", syncPanels);
    };
  }, [collapsePanelsOnNarrow, hasRightPanel, initialRightOpen, moveFocusBeforeRightPanelCollapse]);

  useEffect(() => {
    return () => {
      if (leftPreviewExitTimerRef.current != null) {
        window.clearTimeout(leftPreviewExitTimerRef.current);
      }
    };
  }, []);

  function showLeftPreview() {
    if (leftPreviewExitTimerRef.current != null) {
      window.clearTimeout(leftPreviewExitTimerRef.current);
      leftPreviewExitTimerRef.current = null;
    }
    setLeftPreviewRendered(true);
    setLeftPreviewOpen(true);
  }

  function hideLeftPreview() {
    setLeftPreviewOpen(false);
    if (leftPreviewExitTimerRef.current != null) {
      window.clearTimeout(leftPreviewExitTimerRef.current);
    }
    leftPreviewExitTimerRef.current = window.setTimeout(() => {
      setLeftPreviewRendered(false);
      leftPreviewExitTimerRef.current = null;
    }, FLOATING_LEFT_PANEL_EXIT_MS);
  }

  function resolveFocusArea(target: EventTarget | null) {
    if (!(target instanceof Element)) {
      return "thread-workspace";
    }

    const area = target.closest<HTMLElement>("[data-focus-area]")?.dataset.focusArea;
    return isFocusAreaName(area) ? area : "thread-workspace";
  }

  const panelControls: ShellPanelControls = {
    left: (
      <button
        className="shell-panel-toggle shell-panel-toggle-left we-toolbar-icon-button cursor-interaction"
        type="button"
        aria-label={isLeftOpen ? "隐藏左栏" : "显示左栏"}
        aria-pressed={isLeftOpen}
        title={isLeftOpen ? "隐藏左栏" : "显示左栏"}
        data-shell-panel-toggle="left"
        onClick={() => setLeftOpen((open) => !open)}
      >
        {isLeftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}
      </button>
    ),
    right: hasRightPanel ? (
      <button
        className="shell-panel-toggle shell-panel-toggle-right we-toolbar-icon-button cursor-interaction"
        type="button"
        aria-label={isRightOpen ? "隐藏右栏" : "显示右栏"}
        aria-pressed={isRightOpen}
        title={isRightOpen ? "隐藏右栏" : "显示右栏"}
        data-shell-panel-toggle="right"
        onClick={() => {
          if (isRightOpen) {
            moveFocusBeforeRightPanelCollapse();
            setRightFullscreen(false);
          } else {
            rightPanelReturnFocusRef.current = document.activeElement instanceof HTMLElement
              ? document.activeElement
              : null;
          }
          setRightPanelOpen(!isRightOpen);
        }}
      >
        {isRightOpen ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
      </button>
    ) : null,
    rightFullscreen: hasRightPanel && !isVeryNarrow ? (
      <button
        className="shell-panel-toggle shell-panel-toggle-right-fullscreen we-toolbar-icon-button cursor-interaction"
        type="button"
        aria-label={isRightFullscreen ? "退出右栏全屏" : "全屏展开右栏"}
        aria-pressed={isRightFullscreen}
        title={isRightFullscreen ? "退出右栏全屏" : "全屏展开右栏"}
        data-shell-panel-fullscreen="right"
        onClick={() => {
          setRightPanelOpen(true);
          setRightFullscreen((fullscreen) => !fullscreen);
        }}
      >
        {isRightFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
      </button>
    ) : null,
  };

  return (
    <main
      className="app-shell"
      data-active-focus-area={activeFocusArea}
      data-hovered-focus-area={hoveredFocusArea}
      data-left-panel-open={isLeftOpen}
      data-left-panel-width={isLeftOpen ? leftWidth : 0}
      data-right-panel-open={hasRightPanel && isRightOpen}
      data-right-panel-fullscreen={isRightPanelFullscreen}
      data-right-panel-width={hasRightPanel && isRightOpen ? renderedRightWidth : 0}
      style={
        {
          "--header-left-slot-width": `${isLeftOpen ? leftWidth : 0}px`,
          "--header-right-slot-width": `${hasRightPanel ? renderedRightWidth : 0}px`,
          "--right-panel-width": `${hasRightPanel && isRightOpen ? visibleRightWidth : 0}px`,
        } as CSSProperties
      }
      onFocusCapture={(event) => setActiveFocusArea(resolveFocusArea(event.target))}
      onPointerOverCapture={(event) => setHoveredFocusArea(resolveFocusArea(event.target))}
    >
      {header(panelControls)}
      {!isLeftOpen ? (
        <div
          className="left-panel-reveal-zone"
          aria-hidden="true"
          onPointerEnter={showLeftPreview}
        />
      ) : null}
      {!isLeftOpen && isLeftPreviewRendered ? (
        <div
          className="floating-left-panel"
          data-floating-left-panel=""
          data-visible={isLeftPreviewOpen ? "true" : "false"}
          style={{ width: Math.max(0, leftWidth - 16) }}
          onPointerEnter={showLeftPreview}
          onPointerLeave={hideLeftPreview}
        >
          <aside className="floating-left-panel-frame">
            <div className="floating-left-panel-header">{panelControls.left}</div>
            <div className="floating-left-panel-body">{left}</div>
          </aside>
          <ResizeHandle
            defaultSize={LEFT_PANEL_DEFAULT_WIDTH}
            edge="right"
            getCurrentSize={() => leftWidth}
            maxSize={LEFT_PANEL_MAX_WIDTH}
            minSize={LEFT_PANEL_MIN_WIDTH}
            onResizeEnd={(width) => writeStoredPanelWidth(LEFT_PANEL_WIDTH_KEY, width)}
            onResizingChange={(resizing) => {
              if (resizing) {
                showLeftPreview();
              }
            }}
            setSize={(size) =>
              setLeftWidth(clampPanelWidth(size, LEFT_PANEL_MIN_WIDTH, LEFT_PANEL_MAX_WIDTH))
            }
          />
        </div>
      ) : null}
      <div className="app-shell-body">
        <ResizablePanel
          className="left-panel-resizer"
          defaultWidth={LEFT_PANEL_DEFAULT_WIDTH}
          isOpen={isLeftOpen}
          side="right"
          width={leftWidth}
          minWidth={LEFT_PANEL_MIN_WIDTH}
          maxWidth={LEFT_PANEL_MAX_WIDTH}
          collapseBelow={LEFT_PANEL_COLLAPSE_WIDTH}
          onCollapse={() => {
            moveFocusBeforePanelCollapse("left-panel", '[data-shell-panel-toggle="left"]');
            setLeftOpen(false);
          }}
          onOpen={() => setLeftOpen(true)}
          onResize={setLeftWidth}
          onResizeEnd={(width) => writeStoredPanelWidth(LEFT_PANEL_WIDTH_KEY, width)}
        >
          {left}
        </ResizablePanel>

        <div className="content-region">
          <div className="content-region-body" ref={contentRegionBodyRef}>
            <div className="main-surface">{workspace}</div>

            {hasRightPanel ? (
              <ResizablePanel
                className="right-panel-resizer"
                defaultWidth={RIGHT_PANEL_DEFAULT_WIDTH}
                isOpen={isRightOpen}
                side="left"
                width={visibleRightWidth}
                minWidth={RIGHT_PANEL_MIN_WIDTH}
                maxWidth={rightPanelMaxWidth}
                collapseBelow={RIGHT_PANEL_COLLAPSE_WIDTH}
                resizable={!isRightPanelFullscreen}
                animationProgress={rightPanelAnimation.progress}
                onCollapse={() => {
                  moveFocusBeforeRightPanelCollapse();
                  setRightPanelOpen(false);
                }}
                onOpen={() => setRightPanelOpen(true)}
                onResize={(width) => {
                  setRightWidth(width);
                  if (contentRegionWidth > 0) {
                    setRightWidthRatio(widthToRightPanelWidthRatio(width, contentRegionWidth));
                  }
                }}
                onResizeEnd={(width) => {
                  writeStoredPanelWidth(RIGHT_PANEL_WIDTH_KEY, width);
                  if (contentRegionWidth > 0) {
                    writeStoredPanelRatio(RIGHT_PANEL_RATIO_KEY, width, contentRegionWidth);
                  }
                }}
              >
                {right}
              </ResizablePanel>
            ) : null}
          </div>
        </div>
      </div>
    </main>
  );
}

export function FocusArea({
  area,
  className = "",
  children,
  style,
}: {
  area: FocusAreaName;
  className?: string;
  children: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className={className} data-focus-area={area} style={style} tabIndex={-1}>
      {children}
    </div>
  );
}

export function LeftPanel({ children }: { children: ReactNode }) {
  return (
    <FocusArea area="left-panel" className="left-panel">
      {children}
    </FocusArea>
  );
}

export function ThreadWorkspace({
  children,
  composer,
  workspaceKey,
}: {
  children: ReactNode;
  composer?: ReactNode;
  workspaceKey?: string;
}) {
  const hasComposer = composer != null;
  const contentFrameRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    if (workspaceKey == null || contentFrameRef.current == null) return;
    contentFrameRef.current.scrollTop = workspaceScrollPositions.get(workspaceKey) ?? 0;
  }, [workspaceKey]);

  return (
    <FocusArea area="thread-workspace" className="thread-workspace">
      <div className="main-content-viewport">
        <div
          ref={contentFrameRef}
          className={
            hasComposer
              ? "main-content-frame codex-scrollbar"
              : "main-content-frame no-bottom-panel codex-scrollbar"
          }
          onScroll={workspaceKey == null ? undefined : (event) => {
            workspaceScrollPositions.set(workspaceKey, event.currentTarget.scrollTop);
          }}
        >
          {children}
        </div>
        {hasComposer ? <BottomPanelSlot>{composer}</BottomPanelSlot> : null}
      </div>
    </FocusArea>
  );
}

export function RightPanel({ children }: { children: ReactNode }) {
  return (
    <FocusArea area="right-panel" className="right-panel">
      {children}
    </FocusArea>
  );
}

export function BottomPanelSlot({ children }: { children: ReactNode }) {
  return (
    <FocusArea area="bottom-panel" className="bottom-panel-slot">
      <div className="bottom-panel-content">{children}</div>
    </FocusArea>
  );
}

export function PanelTabs({
  tabs,
  defaultValue,
  ariaLabel,
  value,
  onValueChange,
}: {
  tabs: Array<{ id: string; label: string; content: ReactNode }>;
  defaultValue: string;
  ariaLabel: string;
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  return (
    <Tabs.Root
      className="panel-tabs we-panel-tabs"
      {...(value == null ? { defaultValue } : { value, onValueChange })}
    >
      <div className="panel-tab-strip">
        <div className="panel-tab-scroll">
          <Tabs.List className="panel-tab-list" aria-label={ariaLabel}>
            {tabs.map((tab) => (
              <Tabs.Trigger
                className="panel-tab-trigger we-panel-tab cursor-interaction"
                title={tab.label}
                value={tab.id}
                key={tab.id}
              >
                <span className="panel-tab-label">{tab.label}</span>
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>
      </div>
      {tabs.map((tab) => (
        <Tabs.Content className="panel-tab-content" value={tab.id} key={tab.id}>
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

export function ResizablePanel({
  side,
  isOpen,
  width,
  defaultWidth,
  minWidth,
  maxWidth,
  collapseBelow,
  onResize,
  onCollapse,
  onOpen,
  onResizeEnd,
  className = "",
  resizable = true,
  animationProgress,
  children,
}: {
  side: "left" | "right";
  isOpen: boolean;
  width: number;
  defaultWidth: number;
  minWidth: number;
  maxWidth: number;
  collapseBelow: number;
  onResize: (width: number) => void;
  onCollapse: () => void;
  onOpen: () => void;
  onResizeEnd?: (width: number) => void;
  className?: string;
  resizable?: boolean;
  animationProgress?: number;
  children: ReactNode;
}) {
  const [isResizing, setIsResizing] = useState(false);
  const panelAnimation = usePanelAnimation(isOpen);
  const progress = Math.max(0, Math.min(1, animationProgress ?? panelAnimation.progress));
  const renderedWidth = progress * width;

  const setSize = useCallback((size: number) => {
    const shouldBeOpen = size >= collapseBelow;
    if (!shouldBeOpen) {
      onCollapse();
      return;
    }
    if (!isOpen) {
      onOpen();
    }
    onResize(clampPanelWidth(size, minWidth, maxWidth));
  }, [
    collapseBelow,
    isOpen,
    maxWidth,
    minWidth,
    onCollapse,
    onOpen,
    onResize,
  ]);

  const handleResizeEnd = useCallback((size: number) => {
    if (size < collapseBelow) {
      onCollapse();
      return;
    }

    if (!isOpen) {
      onOpen();
    }
    const nextWidth = clampPanelWidth(size, minWidth, maxWidth);
    onResize(nextWidth);
    onResizeEnd?.(nextWidth);
  }, [
    collapseBelow,
    isOpen,
    maxWidth,
    minWidth,
    onCollapse,
    onOpen,
    onResize,
    onResizeEnd,
  ]);

  return (
    <div
      className={`resizable-panel ${className}`}
      aria-hidden={!isOpen}
      data-open={isOpen ? "true" : "false"}
      data-resizing={isResizing ? "true" : "false"}
      inert={!isOpen}
      style={
        {
          opacity: progress,
          flexBasis: renderedWidth,
          maxWidth,
          minWidth: 0,
          "--resizable-panel-content-width": `${width}px`,
          width: renderedWidth,
        } as CSSProperties
      }
    >
      {resizable && side === "left" && (isOpen || isResizing) ? (
        <ResizeHandle
          defaultSize={defaultWidth}
          edge="left"
          getCurrentSize={() => width}
          maxSize={maxWidth}
          minSize={minWidth}
          onResizeEnd={handleResizeEnd}
          onResizingChange={setIsResizing}
          setSize={setSize}
        />
      ) : null}
      <div className="resizable-panel-content">{children}</div>
      {resizable && side === "right" && (isOpen || isResizing) ? (
        <ResizeHandle
          defaultSize={defaultWidth}
          edge="right"
          getCurrentSize={() => width}
          maxSize={maxWidth}
          minSize={minWidth}
          onResizeEnd={handleResizeEnd}
          onResizingChange={setIsResizing}
          setSize={setSize}
        />
      ) : null}
    </div>
  );
}

function clampPanelWidth(size: number, minWidth: number, maxWidth: number) {
  return Math.min(maxWidth, Math.max(minWidth, Math.round(size)));
}

function usePanelAnimation(isVisible: boolean) {
  const initialProgress = isVisible ? 1 : 0;
  const progressRef = useRef(initialProgress);
  const [progress, setProgressState] = useState(initialProgress);
  const prefersReducedMotion = usePrefersReducedMotion();
  const setProgress = useCallback((nextProgress: number) => {
    progressRef.current = nextProgress;
    setProgressState(nextProgress);
  }, []);

  useEffect(() => {
    let frame = 0;
    const startProgress = progressRef.current;
    const targetProgress = isVisible ? 1 : 0;
    if (startProgress === targetProgress) {
      return;
    }
    if (prefersReducedMotion) {
      setProgress(targetProgress);
      return;
    }

    const startedAt = performance.now();
    const animate = (now: number) => {
      const elapsed = Math.min(1, (now - startedAt) / PANEL_ANIMATION_DURATION_MS);
      const eased = 1 - Math.pow(1 - elapsed, 3);
      setProgress(startProgress + (targetProgress - startProgress) * eased);
      if (elapsed < 1) {
        frame = window.requestAnimationFrame(animate);
      }
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [isVisible, prefersReducedMotion, setProgress]);

  return { progress };
}

function usePrefersReducedMotion() {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(() =>
    window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}

function useDevicePixelRatio() {
  const [devicePixelRatio, setDevicePixelRatio] = useState(() => window.devicePixelRatio || 1);

  useEffect(() => {
    let frame = 0;
    const updateDevicePixelRatio = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        setDevicePixelRatio(window.devicePixelRatio || 1);
      });
    };

    window.addEventListener("resize", updateDevicePixelRatio);
    const mediaQuery = window.matchMedia?.(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    mediaQuery?.addEventListener("change", updateDevicePixelRatio, { once: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateDevicePixelRatio);
      mediaQuery?.removeEventListener("change", updateDevicePixelRatio);
    };
  }, [devicePixelRatio]);

  return devicePixelRatio;
}

function computeResizeSize(edge: ResizeEdge, point: PointerPoint, state: ResizeDragState) {
  const delta = (edge === "left" || edge === "right" ? point.x : point.y) - state.startPosition;

  switch (edge) {
    case "bottom":
    case "right":
      return state.startSize + delta;
    case "left":
    case "top":
      return state.startSize - delta;
  }
}

function ResizeHandle({
  disabled = false,
  defaultSize,
  edge,
  getCurrentSize,
  maxSize,
  minSize,
  onResizeEnd,
  onResizingChange,
  setSize,
}: {
  disabled?: boolean;
  defaultSize: number;
  edge: ResizeEdge;
  getCurrentSize: () => number;
  maxSize: number;
  minSize: number;
  onResizeEnd?: (size: number) => void;
  onResizingChange?: (isResizing: boolean) => void;
  setSize: (size: number) => void;
}) {
  const [isResizing, setResizing] = useState(false);
  const dragStateRef = useRef<ResizeDragState | null>(null);
  const isHorizontal = edge === "left" || edge === "right";
  const devicePixelRatio = useDevicePixelRatio();
  const toPoint = useCallback(
    (event: PointerEvent): PointerPoint => ({
      x: event.clientX / devicePixelRatio,
      y: event.clientY / devicePixelRatio,
    }),
    [devicePixelRatio],
  );
  const axisValue = useCallback(
    (point: PointerPoint) => (isHorizontal ? point.x : point.y),
    [isHorizontal],
  );
  const finishResize = useCallback(() => {
    dragStateRef.current = null;
    setResizing(false);
    onResizingChange?.(false);
  }, [onResizingChange]);

  useEffect(() => {
    if (disabled && dragStateRef.current != null) {
      finishResize();
    }
  }, [disabled, finishResize]);

  useEffect(() => {
    if (!isResizing || disabled) {
      return;
    }

    function handlePointerMove(event: PointerEvent) {
      event.preventDefault();
      const dragState = dragStateRef.current;
      if (dragState == null) {
        return;
      }

      const point = toPoint(event);
      if (axisValue(point) !== dragState.startPosition) {
        dragState.didMove = true;
      }
      setSize(computeResizeSize(edge, point, dragState));
    }

    function handlePointerUp(event: PointerEvent) {
      event.preventDefault();
      const dragState = dragStateRef.current;
      if (dragState?.didMove === true) {
        const nextSize = computeResizeSize(edge, toPoint(event), dragState);
        setSize(nextSize);
        onResizeEnd?.(nextSize);
      }
      finishResize();
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [
    axisValue,
    disabled,
    edge,
    finishResize,
    isResizing,
    onResizeEnd,
    setSize,
    toPoint,
  ]);

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || event.button !== 0) {
      return;
    }

    event.preventDefault();
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic packaged-smoke drags do not always create a capturable pointer.
    }
    dragStateRef.current = {
      didMove: false,
      startPosition: (isHorizontal ? event.clientX : event.clientY) / devicePixelRatio,
      startSize: getCurrentSize(),
    };
    setResizing(true);
    onResizingChange?.(true);
  }

  function handleClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (disabled || event.detail !== 2) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = null;
    setResizing(false);
    onResizingChange?.(false);
    setSize(defaultSize);
    onResizeEnd?.(defaultSize);
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const direction = event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
    const matchesAxis = isHorizontal
      ? event.key === "ArrowLeft" || event.key === "ArrowRight"
      : event.key === "ArrowUp" || event.key === "ArrowDown";
    if (disabled || !matchesAxis) return;

    event.preventDefault();
    const edgeDirection = edge === "left" || edge === "top" ? -1 : 1;
    const nextSize = clampPanelWidth(
      getCurrentSize() + direction * edgeDirection * 8,
      minSize,
      maxSize,
    );
    setSize(nextSize);
    onResizeEnd?.(nextSize);
  }

  return (
    <ResizeHandleSurface
      currentSize={getCurrentSize()}
      disabled={disabled}
      edge={edge}
      isResizing={isResizing}
      maxSize={maxSize}
      minSize={minSize}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    />
  );
}

function ResizeHandleSurface({
  currentSize,
  disabled,
  edge,
  isResizing,
  maxSize,
  minSize,
  onClick,
  onKeyDown,
  onPointerDown,
}: {
  currentSize: number;
  disabled: boolean;
  edge: ResizeEdge;
  isResizing: boolean;
  maxSize: number;
  minSize: number;
  onClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const isHorizontal = edge === "left" || edge === "right";

  return (
    <div
      className={`resize-handle resize-handle-${edge}`}
      data-resizing={isResizing ? "true" : "false"}
      data-disabled={disabled ? "true" : "false"}
      role="separator"
      aria-disabled={disabled || undefined}
      aria-orientation={isHorizontal ? "vertical" : "horizontal"}
      aria-label={isHorizontal ? "调整面板宽度" : "调整面板高度"}
      aria-valuemax={Math.round(maxSize)}
      aria-valuemin={Math.round(minSize)}
      aria-valuenow={Math.round(currentSize)}
      aria-valuetext={`${Math.round(currentSize)} 像素`}
      tabIndex={disabled ? -1 : 0}
      onClick={onClick}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
    >
      <div className="resize-handle-line" />
    </div>
  );
}

function moveFocusBeforePanelCollapse(
  area: FocusAreaName,
  toggleSelector: string,
  preferredTarget?: HTMLElement | null,
) {
  const panels = document.querySelectorAll<HTMLElement>(`[data-focus-area="${area}"]`);
  const resizerSelector = area === "left-panel"
    ? ".left-panel-resizer [role=\"separator\"]"
    : area === "right-panel"
      ? ".right-panel-resizer [role=\"separator\"]"
      : null;
  const focusIsInsidePanel = [...panels].some((panel) => panel.contains(document.activeElement));
  const focusIsOnResizer = resizerSelector != null
    && document.activeElement?.matches(resizerSelector);
  const focusIsOnToggle = document.activeElement?.matches(toggleSelector);
  if (!focusIsInsidePanel && !focusIsOnResizer && !focusIsOnToggle) return;

  const target = preferredTarget?.isConnected && preferredTarget.getClientRects().length > 0
    ? preferredTarget
    : [...document.querySelectorAll<HTMLElement>(toggleSelector)]
    .find((element) => element !== document.activeElement && element.getClientRects().length > 0)
    ?? document.querySelector<HTMLElement>('[data-focus-area="thread-workspace"]');
  target?.focus();
}

function isFocusAreaName(area: string | undefined): area is FocusAreaName {
  return (
    area === "left-panel" ||
    area === "thread-workspace" ||
    area === "right-panel" ||
    area === "bottom-panel"
  );
}

function readStoredPanelWidth(
  key: string,
  fallback: number,
  minWidth: number,
  maxWidth: number,
) {
  try {
    const storedValue = window.localStorage.getItem(key);
    if (storedValue == null) return fallback;
    const storedWidth = Number(storedValue);
    return Number.isFinite(storedWidth)
      ? Math.min(maxWidth, Math.max(minWidth, storedWidth))
      : fallback;
  } catch {
    return fallback;
  }
}

function writeStoredPanelWidth(key: string, width: number) {
  try {
    window.localStorage.setItem(key, String(Math.round(width)));
  } catch {
    // Layout persistence is a local convenience and must never block the shell.
  }
}

function readStoredPanelRatio(key: string) {
  try {
    const storedValue = window.localStorage.getItem(key);
    if (storedValue == null) {
      return null;
    }

    const storedRatio = Number(storedValue);
    return Number.isFinite(storedRatio) ? clamp01(storedRatio) : null;
  } catch {
    return null;
  }
}

function writeStoredPanelRatio(key: string, width: number, mainContentWidth: number) {
  try {
    window.localStorage.setItem(
      key,
      String(widthToRightPanelWidthRatio(width, mainContentWidth)),
    );
  } catch {
    // Layout persistence is a local convenience and must never block the shell.
  }
}

function rememberedRightPanelState(states: Map<string, boolean>, stateKey: string, fallback: boolean) {
  const memoryState = states.get(stateKey);
  if (memoryState != null) return memoryState;
  const storedState = readStoredRightPanelState(stateKey);
  const resolvedState = storedState ?? fallback;
  states.set(stateKey, resolvedState);
  return resolvedState;
}

function readStoredRightPanelState(stateKey: string) {
  try {
    const stored = window.localStorage.getItem(`${RIGHT_PANEL_OPEN_KEY_PREFIX}${stateKey}`);
    return stored === "open" ? true : stored === "closed" ? false : null;
  } catch {
    return null;
  }
}

function writeStoredRightPanelState(stateKey: string, open: boolean) {
  try {
    window.localStorage.setItem(
      `${RIGHT_PANEL_OPEN_KEY_PREFIX}${stateKey}`,
      open ? "open" : "closed",
    );
  } catch {
    // Per-thread panel state is a local preference and must never block the shell.
  }
}

function widthToRightPanelWidthRatio(width: number, mainContentWidth: number) {
  const range = getRightPanelWidthRange(mainContentWidth);
  const rangeSpan = range.maximum - range.minimum;
  return rangeSpan === 0
    ? 0
    : clamp01((clampRightPanelWidth(width, mainContentWidth) - range.minimum) / rangeSpan);
}

function rightPanelWidthRatioToPixels(ratio: number, mainContentWidth: number) {
  const range = getRightPanelWidthRange(mainContentWidth);
  return clampRightPanelWidth(
    range.minimum + clamp01(ratio) * (range.maximum - range.minimum),
    mainContentWidth,
  );
}

function clampRightPanelWidth(width: number, mainContentWidth: number) {
  const availableWidth = getAvailableRightPanelWidth(mainContentWidth);
  const fallbackWidth = Number.isFinite(width) ? width : RIGHT_PANEL_DEFAULT_WIDTH;
  return Math.max(
    Math.min(RIGHT_PANEL_MIN_WIDTH, availableWidth),
    Math.min(fallbackWidth, availableWidth),
  );
}

function getRightPanelWidthRange(mainContentWidth: number) {
  const availableWidth = getAvailableRightPanelWidth(mainContentWidth);
  return {
    maximum: availableWidth,
    minimum: Math.min(RIGHT_PANEL_MIN_WIDTH, availableWidth),
  };
}

function getAvailableRightPanelWidth(mainContentWidth: number, isFullWidth = false) {
  if (mainContentWidth <= 0) return RIGHT_PANEL_DEFAULT_WIDTH;

  const minimumWidth = Math.min(RIGHT_PANEL_MIN_WIDTH, mainContentWidth);
  const availableWidth = isFullWidth
    ? mainContentWidth
    : mainContentWidth - RIGHT_PANEL_RESERVED_WIDTH;
  return Math.min(mainContentWidth, Math.max(minimumWidth, availableWidth));
}

function getResponsiveRightPanelMaxWidth(
  mainContentWidth: number,
  isFullWidth: boolean,
  collapsePanelsOnNarrow: boolean,
) {
  const availableWidth = getAvailableRightPanelWidth(mainContentWidth, isFullWidth);
  if (
    isFullWidth ||
    !collapsePanelsOnNarrow ||
    mainContentWidth <= 0 ||
    mainContentWidth > 960
  ) {
    return availableWidth;
  }
  return Math.max(
    Math.min(RIGHT_PANEL_MIN_WIDTH, availableWidth),
    Math.floor(mainContentWidth * NARROW_RIGHT_PANEL_MAX_RATIO),
  );
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}
