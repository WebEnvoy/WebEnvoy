import type { PointerEvent as ReactPointerEvent } from "react";
import { useEffect, useId, useRef, useState } from "react";

type NavigationRailOutput = {
  label?: string | null;
  type: string;
};

export type ThreadNavigationItem = {
  getLabel(): string;
  getPreview(): {
    outputs: NavigationRailOutput[];
    response: string;
  };
  hasOutput?: boolean;
  id: string;
  isHeartbeat?: boolean;
};

type PointerScrubState = {
  itemId: string;
  pointerCaptureTarget: HTMLElement;
  pointerId: number;
};

type PointerRailTarget = {
  button: HTMLButtonElement;
  item: ThreadNavigationItem;
};

export function ThreadNavigationRail({
  activeItemId,
  ariaLabel = "Core-owned run navigation",
  items,
  minimumItemCount = 4,
  onActiveItemChange,
}: {
  activeItemId?: string;
  ariaLabel?: string;
  items: ThreadNavigationItem[];
  minimumItemCount?: number;
  onActiveItemChange?: (itemId: string) => void;
}) {
  if (items.length < minimumItemCount) {
    return null;
  }

  return (
    <ThreadNavigationRailBody
      activeItemId={activeItemId}
      ariaLabel={ariaLabel}
      items={items}
      onActiveItemChange={onActiveItemChange}
    />
  );
}

function ThreadNavigationRailBody({
  activeItemId: controlledActiveItemId,
  ariaLabel,
  items,
  onActiveItemChange,
}: {
  activeItemId?: string;
  ariaLabel: string;
  items: ThreadNavigationItem[];
  onActiveItemChange?: (itemId: string) => void;
}) {
  const lastItemId = items.at(-1)?.id ?? null;
  const initialActiveItemId = controlledActiveItemId ?? lastItemId;
  const [visibleItemIds, setVisibleItemIds] = useState<Set<string>>(() =>
    new Set(initialActiveItemId == null ? [] : [initialActiveItemId]),
  );
  const [isPointerInsideRail, setIsPointerInsideRail] = useState(false);
  const [rovingItemId, setRovingItemId] = useState<string | null>(initialActiveItemId);
  const [scrubbedItemId, setScrubbedItemId] = useState<string | null>(null);
  const [hoverTarget, setHoverTarget] = useState<PointerRailTarget | null>(null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const railListRef = useRef<HTMLDivElement | null>(null);
  const pointerScrubRef = useRef<PointerScrubState | null>(null);
  const suppressClickAfterScrubRef = useRef(false);
  const tooltipId = useId();
  const itemIdsSignature = items.map(getNavigationItemId).join("\0");
  const controlledItemExists =
    controlledActiveItemId != null && items.some((item) => item.id === controlledActiveItemId);
  const activeItemId =
    items.find((item) => visibleItemIds.has(item.id))?.id ??
    (controlledItemExists ? controlledActiveItemId : null) ??
    lastItemId;
  const tooltipTop =
    hoverTarget == null
      ? "50%"
      : `${
          (railListRef.current?.offsetTop ?? 0) +
          hoverTarget.button.offsetTop +
          hoverTarget.button.offsetHeight / 2
        }px`;

  useEffect(() => {
    const scrollElement = document.querySelector(".main-content-frame");
    if (scrollElement == null || typeof IntersectionObserver === "undefined") {
      return;
    }
    const scrollRoot = scrollElement;

    const intersectingItemIds = new Set<string>();
    const itemIdByElement = new Map<Element, string>();
    const observedElements = new Set<Element>();
    const orderedItemIds = itemIdsSignature.length === 0 ? [] : itemIdsSignature.split("\0");
    const orderedItemIdSet = new Set(orderedItemIds);

    function updateVisibleItemRange() {
      const firstVisibleIndex = orderedItemIds.findIndex((itemId) =>
        intersectingItemIds.has(itemId),
      );
      if (firstVisibleIndex === -1) {
        return;
      }

      const lastVisibleIndex = findLastIndex(orderedItemIds, (itemId) =>
        intersectingItemIds.has(itemId),
      );
      const nextVisibleItemIds = new Set(
        orderedItemIds.slice(firstVisibleIndex, lastVisibleIndex + 1),
      );
      setVisibleItemIds((previousVisibleItemIds) =>
        previousVisibleItemIds.size === nextVisibleItemIds.size &&
        [...previousVisibleItemIds].every((itemId) => nextVisibleItemIds.has(itemId))
          ? previousVisibleItemIds
          : nextVisibleItemIds,
      );
    }

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!(entry.target instanceof HTMLElement)) {
            continue;
          }

          const itemId = itemIdByElement.get(entry.target);
          if (itemId == null) {
            continue;
          }

          if (entry.isIntersecting) {
            intersectingItemIds.add(itemId);
          } else {
            intersectingItemIds.delete(itemId);
          }
        }
        updateVisibleItemRange();
      },
      { root: scrollRoot, rootMargin: "-16px 0px 0px 0px" },
    );

    function refreshObservedElements() {
      const currentObservedElements = new Set<Element>();
      for (const contentUnitElement of scrollRoot.querySelectorAll<HTMLElement>(
        "[data-content-search-unit-key]",
      )) {
        const itemId = contentUnitElement.dataset.contentSearchUnitKey;
        if (itemId == null || !orderedItemIdSet.has(itemId)) {
          continue;
        }

        const turnElement = contentUnitElement.closest(
          "[data-turn-key], [data-content-search-turn-key]",
        );
        const observedElement =
          turnElement == null || currentObservedElements.has(turnElement)
            ? contentUnitElement
            : turnElement;
        currentObservedElements.add(observedElement);
        itemIdByElement.set(observedElement, itemId);
        if (!observedElements.has(observedElement)) {
          intersectionObserver.observe(observedElement);
          observedElements.add(observedElement);
        }
      }

      for (const observedElement of observedElements) {
        if (currentObservedElements.has(observedElement)) {
          continue;
        }

        const itemId = itemIdByElement.get(observedElement);
        if (itemId != null) {
          intersectingItemIds.delete(itemId);
        }
        itemIdByElement.delete(observedElement);
        intersectionObserver.unobserve(observedElement);
        observedElements.delete(observedElement);
      }
      updateVisibleItemRange();
    }

    const contentMutationObserver = new MutationObserver((mutations) => {
      if (mutationTouchesTurnContent(mutations)) {
        refreshObservedElements();
      }
    });
    contentMutationObserver.observe(scrollRoot, { childList: true, subtree: true });
    refreshObservedElements();

    return () => {
      contentMutationObserver.disconnect();
      intersectionObserver.disconnect();
    };
  }, [itemIdsSignature]);

  useEffect(() => {
    if (scrubbedItemId == null) {
      scrollRailButtonIntoView(railListRef.current, activeItemId);
    }
  }, [activeItemId, scrubbedItemId]);

  useEffect(() => {
    if (rovingItemId == null || !items.some((item) => item.id === rovingItemId)) {
      setRovingItemId(activeItemId);
    }
  }, [activeItemId, itemIdsSignature, items, rovingItemId]);

  useEffect(() => {
    if (!controlledItemExists || controlledActiveItemId == null) {
      return;
    }
    setVisibleItemIds((previousVisibleItemIds) =>
      previousVisibleItemIds.has(controlledActiveItemId)
        ? previousVisibleItemIds
        : new Set([controlledActiveItemId]),
    );
  }, [controlledActiveItemId, controlledItemExists, itemIdsSignature]);

  function scrollToNavigationItem(item: ThreadNavigationItem, scrollBehavior: ScrollBehavior) {
    const scrollElement = document.querySelector(".main-content-frame");
    if (scrollElement == null) {
      return;
    }

    const targetElement = findContentSearchUnitElement(scrollElement, item.id);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    targetElement?.scrollIntoView({
      behavior: reducedMotion ? "instant" : scrollBehavior,
      block: "start",
    });
    onActiveItemChange?.(item.id);
    animateNavigationTargetHighlight(targetElement);
  }

  function finishPointerScrub(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerScrub = pointerScrubRef.current;
    if (pointerScrub?.pointerId !== event.pointerId) {
      return;
    }

    pointerScrubRef.current = null;
    setScrubbedItemId(null);
    if (pointerScrub.pointerCaptureTarget.hasPointerCapture?.(event.pointerId)) {
      pointerScrub.pointerCaptureTarget.releasePointerCapture?.(event.pointerId);
    }
    if (!isPointerInsideRail) {
      setHoverTarget(null);
      setTooltipOpen(false);
    }
    window.setTimeout(() => {
      suppressClickAfterScrubRef.current = false;
    }, 0);
  }

  function handlePointerDownCapture(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) {
      return;
    }

    const pointerTarget = getPointerRailTarget(
      items,
      event.currentTarget,
      event.target instanceof Element ? event.target : null,
    );
    if (pointerTarget == null) {
      return;
    }

    suppressClickAfterScrubRef.current = false;
    pointerScrubRef.current = {
      itemId: pointerTarget.item.id,
      pointerCaptureTarget: pointerTarget.button,
      pointerId: event.pointerId,
    };
    setIsPointerInsideRail(true);
    setScrubbedItemId(pointerTarget.item.id);
    setHoverTarget(pointerTarget);
    setTooltipOpen(true);
    pointerTarget.button.setPointerCapture?.(event.pointerId);
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const pointerScrub = pointerScrubRef.current;
    if (pointerScrub == null) {
      const pointerTarget = getPointerRailTarget(
        items,
        event.currentTarget,
        event.target instanceof Element ? event.target : null,
      );
      if (pointerTarget != null) {
        setHoverTarget((currentTarget) =>
          currentTarget?.item.id === pointerTarget.item.id ? currentTarget : pointerTarget,
        );
        setTooltipOpen(true);
      }
      return;
    }

    if (pointerScrub.pointerId !== event.pointerId) {
      return;
    }

    if (event.buttons % 2 === 0) {
      finishPointerScrub(event);
      return;
    }

    const railBounds = event.currentTarget.getBoundingClientRect();
    const pointerTarget = getPointerRailTarget(
      items,
      event.currentTarget,
      document.elementFromPoint(
        railBounds.left + railBounds.width / 2,
        Math.max(railBounds.top, Math.min(event.clientY, railBounds.bottom - 1)),
      ),
    );
    if (pointerTarget == null || pointerTarget.item.id === pointerScrub.itemId) {
      return;
    }

    pointerScrubRef.current = { ...pointerScrub, itemId: pointerTarget.item.id };
    suppressClickAfterScrubRef.current = true;
    setScrubbedItemId(pointerTarget.item.id);
    setHoverTarget(pointerTarget);
    scrollToNavigationItem(pointerTarget.item, "instant");
  }

  const tooltipItem = hoverTarget?.item;

  return (
    <nav
      className="thread-navigation-rail"
      aria-label={ariaLabel}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setHoverTarget(null);
        setTooltipOpen(false);
      }}
    >
      <div
        className="thread-navigation-rail-list vertical-scroll-fade-mask hide-scrollbar"
        data-scrubbing={scrubbedItemId == null ? undefined : true}
        ref={railListRef}
        onLostPointerCapture={finishPointerScrub}
        onPointerCancelCapture={finishPointerScrub}
        onPointerDownCapture={handlePointerDownCapture}
        onPointerEnter={() => setIsPointerInsideRail(true)}
        onPointerLeave={() => {
          setIsPointerInsideRail(false);
          if (pointerScrubRef.current == null) {
            setHoverTarget(null);
            setTooltipOpen(false);
          }
        }}
        onPointerMove={handlePointerMove}
        onPointerUpCapture={finishPointerScrub}
      >
        <div className="thread-navigation-rail-rows">
          {items.map((item, index) => (
            <button
              className="thread-navigation-row"
              data-thread-user-message-navigation-item-id={item.id}
              data-scrub-target={scrubbedItemId === item.id ? true : undefined}
              aria-current={activeItemId === item.id ? "true" : undefined}
              aria-describedby={
                tooltipOpen && hoverTarget?.item.id === item.id ? tooltipId : undefined
              }
              aria-label={`跳转到回合：${item.getLabel().trim() || `回合 ${index + 1}`}`}
              key={item.id}
              tabIndex={rovingItemId === item.id ? 0 : -1}
              title={item.getLabel()}
              type="button"
              onClick={(event) => {
                if (suppressClickAfterScrubRef.current) {
                  suppressClickAfterScrubRef.current = false;
                  return;
                }
                const pointerTarget = { button: event.currentTarget, item };
                setHoverTarget(pointerTarget);
                setTooltipOpen(true);
                scrollToNavigationItem(item, "smooth");
              }}
              onFocus={(event) => {
                setRovingItemId(item.id);
                setHoverTarget({ button: event.currentTarget, item });
                setTooltipOpen(true);
              }}
              onKeyDown={(event) => {
                const nextIndex = event.key === "Home"
                  ? 0
                  : event.key === "End"
                    ? items.length - 1
                    : event.key === "ArrowUp"
                      ? Math.max(0, index - 1)
                      : event.key === "ArrowDown"
                        ? Math.min(items.length - 1, index + 1)
                        : -1;
                if (nextIndex < 0) return;

                event.preventDefault();
                const nextItem = items[nextIndex];
                setRovingItemId(nextItem.id);
                findRailButtonElement(railListRef.current, nextItem.id)?.focus();
              }}
              onPointerEnter={(event) => {
                setHoverTarget({ button: event.currentTarget, item });
                setTooltipOpen(true);
              }}
              onMouseEnter={(event) => {
                setHoverTarget({ button: event.currentTarget, item });
                setTooltipOpen(true);
              }}
            >
              <span className="thread-navigation-marker-frame">
                <span className="thread-navigation-marker" />
              </span>
            </button>
          ))}
        </div>
      </div>
      {tooltipOpen && tooltipItem != null ? (
        <ThreadNavigationTooltipPreview id={tooltipId} item={tooltipItem} top={tooltipTop} />
      ) : null}
    </nav>
  );
}

function ThreadNavigationTooltipPreview({
  id,
  item,
  top,
}: {
  id: string;
  item: ThreadNavigationItem;
  top: string;
}) {
  const preview = item.getPreview();
  const label = item.getLabel();

  return (
    <div className="thread-navigation-tooltip" id={id} role="tooltip" style={{ top }}>
      <strong>{label.length === 0 ? "无内容" : label}</strong>
      {preview.response.length > 0 ? <p>{preview.response}</p> : null}
      {preview.outputs.length > 0 ? (
        <div className="thread-navigation-output-row">
          {preview.outputs.slice(0, 2).map((output, index) => (
            <span key={`${output.type}:${output.label ?? index}`}>
              {output.label ?? output.type}
            </span>
          ))}
          {preview.outputs.length > 2 ? <span>+{preview.outputs.length - 2}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function getNavigationItemId(item: ThreadNavigationItem) {
  return item.id;
}

function findContentSearchUnitElement(scrollElement: Element, itemId: string) {
  return scrollElement.querySelector<HTMLElement>(
    `[data-content-search-unit-key="${escapeSelectorAttributeValue(itemId)}"]`,
  );
}

function scrollRailButtonIntoView(railListElement: HTMLElement | null, itemId: string | null) {
  if (railListElement == null) {
    return;
  }

  const buttonElement = findRailButtonElement(railListElement, itemId);
  if (buttonElement == null) {
    return;
  }

  if (buttonElement.offsetTop < railListElement.scrollTop) {
    railListElement.scrollTop = buttonElement.offsetTop;
  } else if (
    buttonElement.offsetTop + buttonElement.offsetHeight >
    railListElement.scrollTop + railListElement.clientHeight
  ) {
    railListElement.scrollTop =
      buttonElement.offsetTop + buttonElement.offsetHeight - railListElement.clientHeight + 1;
  }
}

function findRailButtonElement(railListElement: HTMLElement | null, itemId: string | null) {
  return itemId == null || railListElement == null
    ? null
    : railListElement.querySelector<HTMLElement>(
        `[data-thread-user-message-navigation-item-id="${escapeSelectorAttributeValue(itemId)}"]`,
      );
}

function getPointerRailTarget(
  items: ThreadNavigationItem[],
  railElement: Element,
  eventTarget: Element | null,
): PointerRailTarget | null {
  const buttonElement = eventTarget?.closest<HTMLButtonElement>(
    "[data-thread-user-message-navigation-item-id]",
  );
  if (buttonElement == null || !railElement.contains(buttonElement)) {
    return null;
  }

  const matchedItem = items.find(
    (item) => item.id === buttonElement.dataset.threadUserMessageNavigationItemId,
  );
  return matchedItem == null ? null : { button: buttonElement, item: matchedItem };
}

function animateNavigationTargetHighlight(targetElement: Element | null | undefined) {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  targetElement?.animate?.(
    [
      { backgroundColor: "rgba(9, 105, 255, 0)" },
      { backgroundColor: "rgba(9, 105, 255, 0.12)", offset: 0.35 },
      { backgroundColor: "rgba(9, 105, 255, 0)" },
    ],
    { duration: 1400, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
  );
}

function mutationTouchesTurnContent(mutations: MutationRecord[]) {
  return mutations.some((mutation) =>
    [...mutation.addedNodes, ...mutation.removedNodes].some(
      (node) =>
        node instanceof HTMLElement &&
        (node.matches(
          "[data-turn-key], [data-content-search-turn-key], [data-content-search-unit-key]",
        ) ||
          node.querySelector(
            "[data-turn-key], [data-content-search-turn-key], [data-content-search-unit-key]",
          ) != null),
    ),
  );
}

function findLastIndex<T>(items: T[], predicate: (item: T) => boolean) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (predicate(items[index])) {
      return index;
    }
  }
  return -1;
}

function escapeSelectorAttributeValue(value: string) {
  return typeof CSS !== "undefined" && CSS.escape != null
    ? CSS.escape(value)
    : value.replace(/"/g, '\\"');
}
