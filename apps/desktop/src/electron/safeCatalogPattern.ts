const maxPatternLength = 512;
const maxGroups = 32;
const maxAlternatives = 64;

type Atom = { kind: "class" | "dot" | "escape-class" | "literal" | "group"; value?: string; optionalGroupSafe?: boolean };
type Group = { alternatives: number; requiredPrefix: boolean };

export function isSafeCatalogPattern(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 2 || value.length > maxPatternLength ||
    value[0] !== "^" || value.at(-1) !== "$" || hasUnsafeVariableOverlap(value)) return false;
  const groups: Group[] = [];
  let alternatives = 0;
  let atom: Atom | null = null;
  for (let index = 1; index < value.length - 1; index += 1) {
    const char = value[index]!;
    if (char === "\\") {
      const escaped = value[++index];
      if (escaped == null || /[1-9]/.test(escaped)) return false;
      atom = /[dDsSwW]/.test(escaped) ? { kind: "escape-class" } : { kind: "literal", value: escaped };
      markRequiredPrefix(groups, atom);
      continue;
    }
    if (char === "[") {
      const end = classEnd(value, index + 1);
      if (end == null) return false;
      index = end;
      atom = { kind: "class" };
      markRequiredPrefix(groups, atom);
      continue;
    }
    if (char === "(") {
      const nonCapturing = value.slice(index, index + 3) === "(?:";
      if ((!nonCapturing && value[index + 1] === "?") || groups.length >= maxGroups) return false;
      groups.push({ alternatives: 0, requiredPrefix: false });
      if (nonCapturing) index += 2;
      atom = null;
      continue;
    }
    if (char === ")") {
      const group = groups.pop();
      if (group == null) return false;
      atom = { kind: "group", optionalGroupSafe: group.alternatives === 0 && group.requiredPrefix };
      markRequiredPrefix(groups, atom);
      continue;
    }
    if (char === "|") {
      if (groups.length === 0 && (value[index - 1] !== "$" || value[index + 1] !== "^")) return false;
      alternatives += 1;
      if (alternatives > maxAlternatives) return false;
      if (groups.length > 0) groups[groups.length - 1]!.alternatives += 1;
      atom = null;
      continue;
    }
    if (char === "*" || char === "+" || char === "?") {
      if (atom == null || value[index + 1] === "?" || !quantifierAllowed(atom, char)) return false;
      atom = null;
      continue;
    }
    if (char === "{") {
      if (atom == null || !["class", "escape-class"].includes(atom.kind)) return false;
      const quantifier = boundedQuantifier(value, index);
      if (quantifier == null) return false;
      index = quantifier.end;
      atom = null;
      continue;
    }
    if (char === ".") {
      atom = { kind: "dot" };
      continue;
    }
    if (char === "^" || char === "$") {
      if (!(char === "$" && value[index + 1] === "|" || char === "^" && value[index - 1] === "|")) return false;
      atom = null;
      continue;
    }
    atom = { kind: "literal", value: char };
    markRequiredPrefix(groups, atom);
  }
  if (groups.length > 0) return false;
  try {
    new RegExp(value);
    return true;
  } catch {
    return false;
  }
}

function hasUnsafeVariableOverlap(value: string) {
  if (value === "^.*\\S.*$") return false;
  const variableAtom = /(\[(?:\\.|[^\]])+\]|\\[dDsSwW]|\.)(\*|\+|\{\d+,(?:\d*)\})/g;
  let match: RegExpExecArray | null;
  let previous: { end: number; characters: Set<number> } | null = null;
  let branchWildcardCount = 0;
  while ((match = variableAtom.exec(value)) != null) {
    const atom = match[1]!;
    const quantifier = match[2]!;
    if (!variableRange(quantifier)) continue;
    const between = previous == null ? value.slice(0, match.index) : value.slice(previous.end, match.index);
    if (between.includes("|")) {
      previous = null;
      branchWildcardCount = 0;
    }
    if (atom === "." && ++branchWildcardCount > 1) return true;
    const characters = atomCharacters(atom);
    if (previous != null && setsOverlap(previous.characters, characters) &&
      !hasRequiredDisjointLiteral(between, previous.characters)) return true;
    previous = { end: match.index + match[0].length, characters };
  }
  return false;
}

function quantifierAllowed(atom: Atom, quantifier: string) {
  if (quantifier === "?" && atom.kind === "group") return atom.optionalGroupSafe === true;
  if (quantifier === "?" && atom.kind === "literal") return atom.value === "/";
  return quantifier !== "?" && ["class", "dot", "escape-class"].includes(atom.kind);
}

function classEnd(value: string, start: number) {
  let escaped = false;
  for (let index = start; index < value.length - 1; index += 1) {
    if (!escaped && value[index] === "]") return index === start ? null : index;
    escaped = !escaped && value[index] === "\\";
    if (value[index] !== "\\") escaped = false;
  }
  return null;
}

function boundedQuantifier(value: string, start: number) {
  const end = value.indexOf("}", start + 1);
  if (end < 0 || value[end + 1] === "?") return null;
  const match = /^(\d+)(?:,(\d*))?$/.exec(value.slice(start + 1, end));
  if (match == null) return null;
  const minimum = Number(match[1]);
  const unbounded = match[2] === "";
  const maximum = match[2] == null ? minimum : unbounded ? Number.POSITIVE_INFINITY : Number(match[2]);
  return minimum <= maximum && minimum <= 100_000 && (unbounded || maximum <= 100_000)
    ? { end, variable: unbounded || minimum !== maximum }
    : null;
}

function variableRange(quantifier: string) {
  if (quantifier === "*" || quantifier === "+") return true;
  const match = /^\{(\d+),(\d*)\}$/.exec(quantifier);
  return match != null && (match[2] === "" || match[1] !== match[2]);
}

function atomCharacters(atom: string) {
  if (atom === ".") return asciiSet(() => true);
  if (atom.startsWith("\\")) return escapedCharacters(atom[1]!);
  const body = atom.slice(1, -1);
  const negated = body.startsWith("^");
  const selected = new Set<number>();
  const source = negated ? body.slice(1) : body;
  for (let index = 0; index < source.length; index += 1) {
    const start = source.charCodeAt(index);
    if (source[index] === "\\" && source[index + 1] != null) {
      for (const code of escapedCharacters(source[++index]!)) selected.add(code);
    } else if (source[index + 1] === "-" && source[index + 2] != null) {
      const end = source.charCodeAt(index + 2);
      for (let code = start; code <= end && code < 128; code += 1) selected.add(code);
      index += 2;
    } else if (start < 128) {
      selected.add(start);
    }
  }
  return negated ? asciiSet((code) => !selected.has(code)) : selected;
}

function escapedCharacters(value: string) {
  const digit = (code: number) => code >= 48 && code <= 57;
  const whitespace = (code: number) => [9, 10, 11, 12, 13, 32].includes(code);
  const word = (code: number) => digit(code) || code >= 65 && code <= 90 || code >= 97 && code <= 122 || code === 95;
  if (value === "d" || value === "D") return asciiSet((code) => value === "d" ? digit(code) : !digit(code));
  if (value === "s" || value === "S") return asciiSet((code) => value === "s" ? whitespace(code) : !whitespace(code));
  if (value === "w" || value === "W") return asciiSet((code) => value === "w" ? word(code) : !word(code));
  return new Set([value.charCodeAt(0)]);
}

function asciiSet(predicate: (code: number) => boolean) {
  const result = new Set<number>();
  for (let code = 0; code < 128; code += 1) if (predicate(code)) result.add(code);
  return result;
}

function setsOverlap(left: Set<number>, right: Set<number>) {
  return [...left].some((code) => right.has(code));
}

function hasRequiredDisjointLiteral(value: string, repeatedCharacters: Set<number>) {
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    if (char === "\\" && value[index + 1] != null) {
      const escaped = value[++index]!;
      if (!/[dDsSwW]/.test(escaped) && !repeatedCharacters.has(escaped.charCodeAt(0))) return true;
      continue;
    }
    if ("()?:^$".includes(char) || char === "|" || ["?", "*", "+", "{"].includes(value[index + 1] ?? "")) continue;
    if (!repeatedCharacters.has(char.charCodeAt(0))) return true;
  }
  return false;
}

function markRequiredPrefix(groups: Group[], atom: Atom) {
  const group = groups.at(-1);
  if (group != null && !group.requiredPrefix && (atom.kind === "literal" || atom.kind === "class" || atom.kind === "escape-class")) {
    group.requiredPrefix = true;
  }
}
