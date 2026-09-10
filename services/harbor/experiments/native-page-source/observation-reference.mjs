// Experimental Driver guard only; formal input paths do not consume this token yet.
export function isCurrentObservation(previous, current) {
  return ['epoch','targetId','windowId','tabId'].every(key =>
    typeof previous?.[key] === 'string' && previous[key].length > 0 && previous[key] === current?.[key]);
}
