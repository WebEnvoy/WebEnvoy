type ComposerInputElement = HTMLElement & {
  focus(): void;
};

type ComposerController = {
  focus(): void;
  insertTextAtSelection(text: string): void;
};

type ComposerRegistration = {
  composerId: string;
  isPrimaryComposer: boolean;
};

const OPEN_OVERLAY_SELECTOR = [
  `[role="dialog"][data-state="open"]`,
  `[role="menu"][data-state="open"]`,
  `[role="listbox"][data-state="open"]`,
].join(", ");

const INPUT_EXCLUSION_SELECTOR = "[data-webenvoy-terminal]";
const registeredComposers = new Map<ComposerInputElement, ComposerRegistration>();
let lastFocusedComposer: ComposerInputElement | null = null;

export function registerComposerInput(
  composerInput: ComposerInputElement,
  registration: ComposerRegistration,
) {
  const rememberFocusedComposer = () => {
    lastFocusedComposer = composerInput;
  };

  registeredComposers.set(composerInput, registration);
  composerInput.addEventListener("focus", rememberFocusedComposer);

  if (document.activeElement === composerInput) {
    lastFocusedComposer = composerInput;
  }

  return () => {
    registeredComposers.delete(composerInput);
    composerInput.removeEventListener("focus", rememberFocusedComposer);
    if (lastFocusedComposer === composerInput) {
      lastFocusedComposer = null;
    }
  };
}

export function focusComposerInput() {
  const composerInput = getActiveComposerInput();

  if (composerInput != null) {
    requestAnimationFrame(() => composerInput.focus());
  }
}

export function handleTypeToComposer({
  composerController,
  event,
}: {
  composerController: ComposerController;
  event: KeyboardEvent;
}) {
  if (isPrintableComposerKey(event) && !isTypingInsideInputSurface(event)) {
    event.preventDefault();
    composerController.focus();
    composerController.insertTextAtSelection(event.key);
  }
}

function getActiveComposerInput(): ComposerInputElement | null {
  if (
    lastFocusedComposer != null &&
    lastFocusedComposer.isConnected &&
    registeredComposers.has(lastFocusedComposer)
  ) {
    return lastFocusedComposer;
  }

  lastFocusedComposer = null;

  for (const [composerInput, registration] of registeredComposers) {
    if (registration.isPrimaryComposer && composerInput.isConnected) {
      return composerInput;
    }
  }

  for (const composerInput of registeredComposers.keys()) {
    if (composerInput.isConnected) {
      return composerInput;
    }
  }

  return document.querySelector("[data-webenvoy-composer]");
}

function isPrintableComposerKey(event: KeyboardEvent) {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.metaKey &&
    !event.ctrlKey &&
    event.key !== " " &&
    event.key !== "\xA0" &&
    event.key.length === 1
  );
}

function isTypingInsideInputSurface(event: Event) {
  return (
    event
      .composedPath()
      .some(
        (target) =>
          target instanceof HTMLElement &&
          (isTextInputElement(target) || target.closest(INPUT_EXCLUSION_SELECTOR) != null),
      ) || document.querySelector(OPEN_OVERLAY_SELECTOR) != null
  );
}

function isTextInputElement(element: HTMLElement | null) {
  if (element == null) {
    return false;
  }

  if (element.isContentEditable) {
    return true;
  }

  const tagName = element.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select"
    ? true
    : element.closest("[contenteditable='true']") != null;
}
