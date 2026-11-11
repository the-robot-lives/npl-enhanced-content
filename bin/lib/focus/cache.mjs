/**
 * focus/cache — the on-disk memory behind `semtext focus`.
 *
 * Root: `$XDG_CACHE_HOME/semtext` (default `~/.cache/semtext`), override
 * with `--cache-dir` / `SEMTEXT_CACHE_DIR`. Layout:
 *
 *   tasks.jsonl                       one JSON object per line:
 *                                     { task_id, purpose, normalized, created, hits }
 *   sections/<sha256>.json            { tldr, generic, model, generated_at,
 *                                     source_snapshot, refs? }
 *                                     key = sha256 of the whitespace-collapsed
 *                                     section text (auto tldr excluded)
 *   notes/<task_id>/<section_sha>.json { score, relevant, note?, model, at }
 *   index/<sha256(abs path)>.json     { path, sections: { id -> section sha } }
 *                                     — the drift-detection side table
 *
 * Every write is atomic (tmp file + rename) so a crashed run can never
 * leave a half-written entry behind. All functions are synchronous: focus
 * is a CLI tool, and section payloads are small.
 */

import { createHash } from 'node:crypto';
import {
  readFileSync,
  writeFileSync,
  renameSync,
  mkdirSync,
  rmSync,
  existsSync
} from 'node:fs';
import { join, dirname } from 'node:path';

export function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function sha12(text) {
  return sha256(text).slice(0, 12);
}

function atomicWriteJson(file, obj) {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1) + '\n');
  renameSync(tmp, file);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Build the cache API over one root directory. Pure fs — no network, no
 * environment (the root is resolved by the caller).
 */
export function makeCache(root) {
  const dirs = {
    sections: join(root, 'sections'),
    notes: join(root, 'notes'),
    index: join(root, 'index'),
    tasksFile: join(root, 'tasks.jsonl')
  };

  /* ---- tasks ---- */

  function loadTasks() {
    let text = '';
    try {
      text = readFileSync(dirs.tasksFile, 'utf8');
    } catch {
      return [];
    }
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const obj = JSON.parse(line);
        if (obj && obj.task_id && obj.normalized) out.push(obj);
      } catch {
        // skip torn lines — a cache may be interrupted mid-append
      }
    }
    return out;
  }

  function saveTasks(tasks) {
    mkdirSync(root, { recursive: true });
    const tmp = `${dirs.tasksFile}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
    writeFileSync(tmp, tasks.map((t) => JSON.stringify(t)).join('\n') + '\n');
    renameSync(tmp, dirs.tasksFile);
  }

  function appendTask(task) {
    const tasks = loadTasks();
    tasks.push(task);
    saveTasks(tasks);
    return task;
  }

  function bumpTask(taskId) {
    const tasks = loadTasks();
    const hit = tasks.find((t) => t.task_id === taskId);
    if (!hit) return;
    hit.hits = (hit.hits || 0) + 1;
    saveTasks(tasks);
  }

  /* ---- sections ---- */

  function sectionPath(key) {
    return join(dirs.sections, key + '.json');
  }

  function getSection(key) {
    return readJson(sectionPath(key));
  }

  function putSection(key, entry) {
    atomicWriteJson(sectionPath(key), entry);
  }

  /* ---- notes (per task per section) ---- */

  function notePath(taskId, key) {
    return join(dirs.notes, taskId, key + '.json');
  }

  function getNote(taskId, key) {
    return readJson(notePath(taskId, key));
  }

  function putNote(taskId, key, note) {
    atomicWriteJson(notePath(taskId, key), note);
  }

  /* ---- per-document index (drift detection) ---- */

  function getIndex(pathSha) {
    return readJson(join(dirs.index, pathSha + '.json'));
  }

  function putIndex(pathSha, entry) {
    atomicWriteJson(join(dirs.index, pathSha + '.json'), entry);
  }

  function clear() {
    rmSync(root, { recursive: true, force: true });
  }

  function exists() {
    return existsSync(root);
  }

  return {
    root,
    paths: { sections: dirs.sections, notes: join(dirs.notes, '<task_id>'), index: dirs.index },
    loadTasks,
    appendTask,
    bumpTask,
    getSection,
    putSection,
    getNote,
    putNote,
    getIndex,
    putIndex,
    clear,
    exists
  };
}
