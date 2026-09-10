// OS facts are optional; missing process identity must not poison page selection.
export function foreground(expectedIdentity, before, after, browserWindowActive) {
  if (typeof expectedIdentity !== 'string' || !/^\d+:\d+$/.test(expectedIdentity) ||
      before?.launch !== expectedIdentity || after?.launch !== expectedIdentity ||
      typeof before.active !== 'boolean' || before.active !== after.active ||
      typeof browserWindowActive !== 'boolean') return null;
  return before.active && browserWindowActive;
}
