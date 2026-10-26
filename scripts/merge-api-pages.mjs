import { createHash, randomUUID } from 'node:crypto';
import { lstat, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = value => createHash('sha256').update(value).digest('hex');
const own = (object, key) => Object.hasOwn(object, key);
const positiveInteger = value => Number.isSafeInteger(value) && value > 0;
const whitespace = char => char !== undefined && /[\x20\t\r\n]/.test(char);

class ConfigurationError extends Error {}

// Retain source spans: converting an item's unknown numeric fields through
// Number/JSON.stringify would change large integers, -0, and exponent notation.
function parseSource(source) {
  JSON.parse(source); // Validate standard JSON, independently of our span reader.
  let position = 0;
  const skip = () => { while (whitespace(source[position])) position++; };
  const fail = () => { throw new Error(`JSON source span is invalid at ${position}`); };
  function string() {
    const start = position++;
    for (; position < source.length; position++) {
      if (source[position] === '\\') position++;
      else if (source[position] === '"') {
        position++;
        return { type: 'string', start, end: position, value: JSON.parse(source.slice(start, position)) };
      }
    }
    fail();
  }
  function value() {
    skip();
    const start = position;
    if (source[position] === '"') return string();
    if (source[position] === '{') {
      position++; skip();
      const fields = new Map();
      if (source[position] !== '}') for (;;) {
        if (source[position] !== '"') fail();
        const key = string().value;
        if (fields.has(key)) throw new Error(`Duplicate JSON object key: ${key}`);
        skip(); if (source[position++] !== ':') fail();
        fields.set(key, value()); skip();
        if (source[position] !== ',') break;
        position++; skip();
      }
      if (source[position++] !== '}') fail();
      return { type: 'object', start, end: position, fields };
    }
    if (source[position] === '[') {
      position++; skip();
      const items = [];
      if (source[position] !== ']') for (;;) {
        items.push(value()); skip();
        if (source[position] !== ',') break;
        position++; skip();
      }
      if (source[position++] !== ']') fail();
      return { type: 'array', start, end: position, items };
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(source.slice(position))?.[0];
    if (!token) fail();
    position += token.length;
    return { type: /^(true|false)$/.test(token) ? 'boolean' : token === 'null' ? 'null' : 'number', start, end: position, raw: token };
  }
  const result = value(); skip();
  if (position !== source.length) fail();
  return result;
}

function metadata(root, field) {
  const node = root.fields.get(field);
  if (!node) return undefined;
  // Validate the count's literal before Number can round a fractional value
  // (for example 1.0000000000000001) into an apparently valid integer.
  if (node.type === 'number') return /^(?:0|[1-9]\d*)$/.test(node.raw) ? Number(node.raw) : NaN;
  if (node.type === 'boolean') return node.raw === 'true';
  return null;
}

function identity(node) {
  if (node?.type === 'string' && node.value.trim()) return node.value;
  if (node?.type === 'number' && /^(?:0|[1-9]\d*)$/.test(node.raw)) return node.raw;
  return null;
}

async function pathIdentity(path) {
  const absolute = resolve(path);
  try {
    const info = await stat(absolute);
    return { absolute, canonical: await realpath(absolute), info };
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    // Reject dangling symlinks as well as absent/non-directory parents.
    try { await lstat(absolute); throw new ConfigurationError(`Dangling output symlink: ${absolute}`); }
    catch (linkError) { if (linkError.code !== 'ENOENT') throw linkError; }
    const parent = await realpath(dirname(absolute));
    if (!(await stat(parent)).isDirectory()) throw new ConfigurationError(`Not a directory: ${parent}`);
    return { absolute, canonical: join(parent, basename(absolute)), info: null };
  }
}

const aliases = (left, right) => left.canonical === right.canonical ||
  (left.info && right.info && left.info.dev === right.info.dev && left.info.ino === right.info.ino);

async function stageFile(path, contents) {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(contents, 'utf8');
    await handle.sync();
    await handle.close();
    return temporary;
  } catch (error) {
    await handle?.close().catch(() => {});
    await rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
}

async function atomicReport(path, report) {
  const temporary = await stageFile(path, `${JSON.stringify(report, null, 2)}\n`);
  try { await rename(temporary, path); }
  finally { await rm(temporary, { force: true }); }
}

function makeReport(options) {
  return {
    schema_version: 1, kind: options.kind ?? null,
    id_field: options.idField ?? (options.kind === 'players' ? 'id' : 'slug'), complete: false,
    scope: { complete_means: 'All supplied raw pages satisfy their reported pagination, row counts and identity checks; not independently verified source completeness, freshness, current-shop scope or reuse permission.', network_requests: 0 },
    summary: { input_files: 0, pages: 0, rows: 0, unique_ids: 0, reported_total: null,
      reported_total_pages: null, expected_total: options.expectedTotal ?? null, expected_pages: options.expectedPages ?? null },
    pages: [], errors: [], warnings: [],
  };
}

/** Merge explicitly supplied raw API page files. Never performs a network request. */
export async function mergeRawPages(options = {}) {
  const report = makeReport(options);
  const error = (code, message, details = {}) => report.errors.push({ code, message, ...details });
  let outputPath, reportPath, safeReport = false;
  let outputTemporary, reportTemporary, outputBackup, outputPublished = false;
  try {
    if (!['players', 'packs'].includes(options.kind)) throw new ConfigurationError('--kind must be players or packs');
    for (const name of ['inputDir', 'output', 'report']) {
      if (typeof options[name] !== 'string' || !options[name]) throw new ConfigurationError(`Missing ${name}`);
    }
    for (const name of ['expectedTotal', 'expectedPages']) {
      if (own(options, name) && !positiveInteger(options[name])) throw new ConfigurationError(`${name} must be a positive safe integer`);
    }
    if (typeof report.id_field !== 'string' || !report.id_field.trim()) throw new ConfigurationError('Invalid --id-field');
    const inputDir = await realpath(resolve(options.inputDir));
    if (!(await stat(inputDir)).isDirectory()) throw new ConfigurationError('--input-dir must be a directory');
    const entries = await readdir(inputDir, { withFileTypes: true });
    // Only .json files are input pages; list ignored names explicitly.
    const names = entries.filter(entry => entry.name.toLowerCase().endsWith('.json')).map(entry => entry.name).sort();
    report.ignored_files = entries.filter(entry => !entry.name.toLowerCase().endsWith('.json')).map(entry => entry.name).sort();
    const inputs = [];
    for (const name of names) {
      const item = await pathIdentity(join(inputDir, name));
      if (!item.info?.isFile()) throw new ConfigurationError(`Input is not a regular file: ${name}`);
      inputs.push({ name, ...item });
    }
    const output = await pathIdentity(options.output);
    const destination = await pathIdentity(options.report);
    outputPath = output.absolute; reportPath = destination.absolute;
    if (aliases(output, destination)) throw new ConfigurationError('Output and report paths alias each other');
    for (const input of inputs) {
      if (aliases(input, output) || aliases(input, destination)) throw new ConfigurationError(`Output/report aliases input: ${input.name}`);
    }
    for (const target of [output, destination]) {
      if (target.info && !target.info.isFile()) throw new ConfigurationError(`Output/report must be regular files: ${target.absolute}`);
      const inside = relative(inputDir, target.canonical);
      if (inside === '' || (inside !== '..' && !inside.startsWith(`..${sep}`) && !isAbsolute(inside))) {
        throw new ConfigurationError('Output/report must be outside the input directory');
      }
    }
    safeReport = true;
    report.summary.input_files = inputs.length;
    if (!inputs.length) error('empty_input', 'No raw .json page files were supplied');
    const pages = [];
    for (const input of inputs) {
      const bytes = await readFile(input.absolute);
      let source, root;
      try { source = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); root = parseSource(source); }
      catch (cause) { error('invalid_json', cause.message, { file: input.name }); continue; }
      if (root.type !== 'object') {
        error('invalid_root', `Raw root must directly contain a ${options.kind} array`, { file: input.name }); continue;
      }
      const allowed = new Set([options.kind, 'total', 'page', 'limit', 'totalPages', 'hasMore']);
      const unknown = [...root.fields.keys()].filter(field => !allowed.has(field));
      if (unknown.length) {
        error('unknown_root_fields', 'Unknown outer fields cannot be silently discarded', { file: input.name, fields: unknown }); continue;
      }
      if (root.fields.get(options.kind)?.type !== 'array') {
        error('invalid_root', `Raw root must directly contain a ${options.kind} array`, { file: input.name }); continue;
      }
      const rows = root.fields.get(options.kind).items;
      const record = { file: input.name, page: metadata(root, 'page') ?? null, limit: metadata(root, 'limit') ?? null,
        total: metadata(root, 'total') ?? null, total_pages: metadata(root, 'totalPages') ?? null,
        has_more: metadata(root, 'hasMore') ?? null, rows: rows.length, bytes: bytes.length, sha256: hash(bytes) };
      report.pages.push(record);
      const { page, limit, total } = record;
      if (!positiveInteger(page) || !positiveInteger(limit) || !Number.isSafeInteger(total) || total < 0) {
        error('invalid_pagination', 'Count metadata must use nonnegative integer literals; page/limit must be positive safe integers and total must be a nonnegative safe integer', { file: input.name }); continue;
      }
      if (!rows.length || total === 0) error('empty_source', 'An empty source cannot establish a complete catalogue', { file: input.name, page });
      const calculatedPages = Math.ceil(total / limit);
      if (page > calculatedPages || (root.fields.has('totalPages') &&
          (!positiveInteger(record.total_pages) || record.total_pages !== calculatedPages)) ||
          (root.fields.has('hasMore') && (typeof record.has_more !== 'boolean' || record.has_more !== (page < calculatedPages)))) {
        error('invalid_pagination', 'Page range, totalPages or hasMore disagrees with total/limit', { file: input.name, page });
      }
      const expectedRows = Math.min(limit, Math.max(0, total - (page - 1) * limit));
      if (rows.length !== expectedRows) error('row_count_mismatch', 'Page row count disagrees with total/page/limit', { file: input.name, page, expected: expectedRows, actual: rows.length });
      pages.push({ record, calculatedPages, rows, source });
    }
    pages.sort((left, right) => left.record.page - right.record.page || left.record.file.localeCompare(right.record.file));
    report.pages.sort((left, right) => (left.page ?? Infinity) - (right.page ?? Infinity) || left.file.localeCompare(right.file));
    report.summary.pages = pages.length;
    const first = pages[0];
    const primaryIds = new Map(), secondaryIds = new Map(), pageNumbers = new Map();
    const slices = [];
    for (const page of pages) {
      const record = page.record, location = { file: record.file, page: record.page };
      if (first) {
        if (record.total !== first.record.total) error('inconsistent_total', 'Page totals differ', location);
        if (record.limit !== first.record.limit) error('inconsistent_limit', 'Page limits differ', location);
        if (page.calculatedPages !== first.calculatedPages) error('inconsistent_total_pages', 'Page counts differ', location);
      }
      if (pageNumbers.has(record.page)) {
        const previous = pageNumbers.get(record.page);
        error('duplicate_page', 'Duplicate pagination page', { ...location, first_file: previous.file,
          same_payload: previous.source === page.source, payload_comparison: 'exact_page_source' });
      } else pageNumbers.set(record.page, { file: record.file, source: page.source });
      for (let index = 0; index < page.rows.length; index++) {
        const item = page.rows[index], where = { ...location, row: index };
        const raw = page.source.slice(item.start, item.end);
        report.summary.rows++;
        if (item.type !== 'object') { error('invalid_item', 'Every page item must be an object', where); continue; }
        const fields = [report.id_field, ...(options.kind === 'packs' ? ['slug', 'id'].filter(field => field !== report.id_field) : [])];
        for (const field of fields) {
          const primary = field === report.id_field;
          if (!item.fields.has(field) && !primary) continue;
          const id = identity(item.fields.get(field));
          if (id === null) {
            error(item.fields.has(field) ? 'invalid_id' : 'missing_id', 'Identity must be a nonempty string or nonnegative integer literal', { ...where, field }); continue;
          }
          const ids = primary ? primaryIds : secondaryIds;
          const key = primary ? id : `${field}\0${id}`;
          if (ids.has(key)) {
            const previous = ids.get(key);
            error(primary ? 'duplicate_id' : 'duplicate_secondary_id', 'Duplicate identity; no rows are silently discarded',
              { ...where, field, id, same_payload: previous.raw === raw, payload_comparison: 'exact_item_source', first: previous.location });
          } else ids.set(key, { raw, location: where });
        }
        slices.push(raw);
      }
    }
    report.summary.unique_ids = primaryIds.size;
    if (first) {
      const total = first.record.total, count = first.calculatedPages;
      report.summary.reported_total = total;
      report.summary.reported_total_pages = count;
      const missingRanges = [];
      let next = 1, missingCount = 0;
      for (const page of [...pageNumbers.keys()].filter(page => page <= count).sort((a, b) => a - b)) {
        if (page > next) { missingRanges.push({ start: next, end: page - 1 }); missingCount += page - next; }
        next = Math.max(next, page + 1);
      }
      if (next <= count) { missingRanges.push({ start: next, end: count }); missingCount += count - next + 1; }
      if (missingCount) error('missing_pages', 'Required metadata page range is incomplete', { missing_count: missingCount, ranges: missingRanges });
      if (report.summary.rows !== total) error('total_row_count_mismatch', 'Collected row count differs from the reported total', { expected: total, actual: report.summary.rows });
      if (own(options, 'expectedTotal') && options.expectedTotal !== total) error('expected_total_mismatch', '--expected-total differs from source metadata');
      if (own(options, 'expectedPages') && options.expectedPages !== count) error('expected_pages_mismatch', '--expected-pages differs from source metadata');
    }
    if (report.errors.length) { await atomicReport(reportPath, report); return { report, exitCode: 1 }; }
    report.complete = true;
    // Stage both before publishing either, with a rollback copy of an existing
    // array. Each rename is atomic; this is not crash-atomic across both files.
    outputTemporary = await stageFile(outputPath, `[\n${slices.join(',\n')}\n]\n`);
    reportTemporary = await stageFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    if (output.info) outputBackup = await stageFile(outputPath, await readFile(outputPath));
    await rename(outputTemporary, outputPath); outputTemporary = undefined;
    outputPublished = true;
    try { await rename(reportTemporary, reportPath); reportTemporary = undefined; }
    catch (cause) {
      if (outputBackup) { await rename(outputBackup, outputPath); outputBackup = undefined; }
      else await rm(outputPath);
      outputPublished = false;
      throw cause;
    }
    outputPublished = false;
    return { report, exitCode: 0 };
  } catch (cause) {
    report.complete = false;
    error('configuration_error', cause.message);
    if (outputPublished) {
      try {
        if (outputBackup) { await rename(outputBackup, outputPath); outputBackup = undefined; }
        else await rm(outputPath);
        outputPublished = false;
      } catch (rollback) {
        error('rollback_error', rollback.message);
        if (outputBackup) report.recovery = { previous_output_backup: outputBackup };
      }
    }
    if (safeReport) await atomicReport(reportPath, report).catch(() => {});
    return { report, exitCode: 2 };
  } finally {
    for (const temporary of [outputTemporary, reportTemporary, outputPublished ? undefined : outputBackup]) {
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
    }
  }
}

function argumentsFor(argv) {
  const names = new Map([['--kind', 'kind'], ['--input-dir', 'inputDir'], ['--output', 'output'], ['--report', 'report'],
    ['--expected-total', 'expectedTotal'], ['--expected-pages', 'expectedPages'], ['--id-field', 'idField']]);
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const name = names.get(argv[index]);
    if (!name || own(options, name) || index + 1 >= argv.length || argv[index + 1].startsWith('--')) throw new ConfigurationError(`Invalid or repeated argument: ${argv[index]}`);
    const value = argv[++index];
    if (name === 'expectedTotal' || name === 'expectedPages') {
      if (!/^[1-9]\d*$/.test(value) || !positiveInteger(Number(value))) throw new ConfigurationError(`${name} must be a positive safe integer`);
      options[name] = Number(value);
    } else options[name] = value;
  }
  return options;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.slice(2).some(value => value === '--help')) {
    process.stdout.write('Offline raw JSON page merger (no network).\n--kind players|packs --input-dir DIR --output FILE --report FILE [--expected-total N] [--expected-pages N] [--id-field FIELD]\nInput: immediate .json files with raw players/packs, total, page, limit and optional totalPages/hasMore; no other root fields. Count metadata requires nonnegative integer literals (no fractions or exponents). Output/report must be outside input-dir and their parent directories must already exist.\nExit: 0 complete, 1 invalid/incomplete raw pages, 2 configuration/path/write failure.\n');
  } else {
    try {
      const result = await mergeRawPages(argumentsFor(process.argv.slice(2)));
      process.stderr.write(`${result.report.complete ? 'complete' : 'incomplete'}: ${result.report.summary.rows} rows, ${result.report.errors.length} errors\n`);
      process.exitCode = result.exitCode;
    } catch (cause) { process.stderr.write(`${cause.message}\n`); process.exitCode = 2; }
  }
}
