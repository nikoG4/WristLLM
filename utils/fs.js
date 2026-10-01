import { statSync, writeFileSync as writeFile, readFileSync as readFile } from "@zos/fs";

export function ensureFile(path, fallback = "") {
  const existing = statSync({ path });
  if (!existing) {
    writeTextFile(path, fallback);
  }
}

export function readTextFile(path, fallback = "") {
  ensureFile(path, fallback);
  const result = readFile({
    path,
    options: {
      encoding: "utf8",
    },
  });

  return typeof result === "string" ? result : fallback;
}

export function writeTextFile(path, data) {
  writeFile({
    path,
    data: String(data),
    options: {
      encoding: "utf8",
    },
  });
}

export function readJsonFile(path, fallback) {
  const raw = readTextFile(path, JSON.stringify(fallback));

  try {
    return JSON.parse(raw);
  } catch (error) {
    writeTextFile(path, JSON.stringify(fallback));
    return fallback;
  }
}

export function writeJsonFile(path, data) {
  writeTextFile(path, JSON.stringify(data));
}
