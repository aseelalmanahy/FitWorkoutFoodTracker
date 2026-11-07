// What decides whether MIG-04 may be applied. preflight and apply run the same verifyBeforeMigration(), so apply never takes
// preflight's word for anything it can check again. The record from preflight only supplies what has to be compared: what
// was there when the backup was taken. Everything that touches the database or the disk comes in through `io`, so each
// decision can be shown refusing, with no database, in scripts/mig-04.test.cjs.
"use strict";
const path = require("node:path");
const { TEST_DB_MARKER_PREFIX } = require("./test-db-guard.cjs");

const TARGET = "fitdb_test";
const MIG = "20261106150000_body_metrics";
const PREVIOUS = "20261106140000_account_tokens";
const EXPECTED_BLOB = "30a8dac92da1f059b4b2a0672191c2d4c705a9da";
const APPLIED_BEFORE = 7;
const MAX_AGE_TO_APPLY_MS = 3_600_000;
const MAX_AGE_TO_VERIFY_MS = 24 * 3_600_000;
const BACKUP_NAME = /^fitdb_test-pre-mig-04-[0-9TZ]+\.dump$/;

class Stop extends Error {}
const stop = (message) => { throw new Stop(message); };

const isCount = (n) => Number.isInteger(n) && n >= 0;

/** Rejects a record that's missing, damaged, out of date, or from another migration. Returns it if it's sound. */
function checkState(state, now, { maxAgeMs, needBackup }) {
  if (state === null || state === undefined) stop("there's no preflight record. Run preflight first.");
  if (typeof state !== "object" || Array.isArray(state)) stop("the preflight record isn't valid. Run preflight again.");
  if (state.blob !== EXPECTED_BLOB) stop("the preflight record is for another version of the migration. Run preflight again.");
  if (typeof state.fingerprint !== "string" || !state.fingerprint || typeof state.markerVersion !== "string" || !state.markerVersion) stop("the preflight record doesn't say which database it was for. Run preflight again.");
  const counts = state.counts;
  if (!counts || typeof counts !== "object" || !isCount(counts.User) || !isCount(counts._prisma_migrations) || !Object.values(counts).every(isCount)) stop("the preflight record's row counts aren't valid. Run preflight again.");
  if (!state.checksums || typeof state.checksums !== "object" || Object.keys(state.checksums).length !== APPLIED_BEFORE) stop("the preflight record's migrations aren't valid. Run preflight again.");
  if (!Number.isFinite(state.takenAt)) stop("the preflight record has no time. Run preflight again.");
  if (state.takenAt > now + 60_000) stop("the preflight record is dated in the future. Run preflight again.");
  if (now - state.takenAt > maxAgeMs) stop(`the preflight record is too old, at over ${Math.round(maxAgeMs / 3_600_000)} hour(s). Run preflight again, then take a new backup.`);
  if (needBackup && !state.backup) stop("there's no verified backup. Run backup first.");
  return state;
}

/** The recorded backup is in the backups folder, and still the same bytes. Uses no database. */
function checkBackupFile(backup, io) {
  if (typeof backup.file !== "string" || !Number.isInteger(backup.size) || typeof backup.sha256 !== "string") stop("the backup's record isn't valid. Take a new backup.");
  if (path.dirname(path.resolve(backup.file)) !== path.resolve(io.backupsFolder) || !BACKUP_NAME.test(path.basename(backup.file))) stop("the recorded backup isn't one this procedure took. Take a new backup.");
  const facts = io.fileFacts(backup.file);
  if (!facts) stop("the verified backup is missing. Take a new backup.");
  if (facts.size !== backup.size || facts.sha256 !== backup.sha256) stop("the verified backup has changed. Take a new backup.");
  io.ok(`backup still intact: ${backup.file}`);
}

function checkIdentity(i) {
  if (i.marker !== TEST_DB_MARKER_PREFIX + TARGET) stop("the database doesn't carry its test marker.");
  if (i.db !== TARGET) stop("the connected database isn't fitdb_test.");
  if (i.schema !== "public") stop("the connected schema isn't public.");
  if (!/^(127\.0\.0\.1|::1)/.test(i.addr ?? "")) stop("the connected server isn't on this machine.");
}

/** No failure, nothing unexpected, the right number, MIG-03 last, and each checksum the file's. */
function checkApplied(rows, checksumOnDisk) {
  const unfinished = rows.filter((r) => !r.finished || r.rolledBack);
  if (unfinished.length) stop(`failed or unfinished migrations: ${unfinished.map((r) => r.name).join(", ")}`);
  if (rows.length !== APPLIED_BEFORE) stop(`expected ${APPLIED_BEFORE} applied migrations, found ${rows.length}.`);
  if (rows[rows.length - 1].name !== PREVIOUS) stop("MIG-03 isn't the latest applied migration.");
  for (const r of rows) {
    const onDisk = checksumOnDisk(r.name);
    if (onDisk === null) stop(`an applied migration isn't on disk: ${r.name}`);
    if (onDisk !== r.checksum) stop(`a recorded checksum differs from its file: ${r.name}`);
  }
}

function checkPending(rows, onDisk) {
  const pending = onDisk.filter((d) => !rows.some((r) => r.name === d));
  if (pending.length !== 1 || pending[0] !== MIG) stop(`pending isn't exactly MIG-04: ${pending.join(", ") || "none"}`);
}

function checkPrismaTarget(t) {
  if (!t || t.db !== TARGET || t.schema !== "public" || !/^(localhost|127\.0\.0\.1):/.test(t.host)) stop("Prisma's own tool doesn't resolve to the verified target.");
  if (!t.listsMig) stop("Prisma's own tool doesn't list MIG-04 as pending.");
}

/** Every table, both ways, so a table added or removed counts as a change too. */
function checkCounts(expected, actual, label) {
  for (const table of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (expected[table] !== actual[table]) stop(`${label}: ${table} was ${expected[table] ?? "absent"}, and is ${actual[table] ?? "absent"}.`);
  }
}

/** Everything that has to be true of the database and the files for MIG-04 to be applied. Changes nothing. */
async function verifyBeforeMigration(io) {
  const urlProblem = io.effectiveUrlProblem();
  if (urlProblem) stop(urlProblem);
  const fileProblem = io.fileProblem();
  if (fileProblem) stop(fileProblem);
  const identity = await io.identity();
  checkIdentity(identity);
  io.ok(`connected to ${identity.db}, schema ${identity.schema}, server ${identity.addr}:${identity.port}, marker ${identity.marker}`);
  const rows = await io.applied();
  checkApplied(rows, io.checksumOnDisk);
  io.ok(`${rows.length} applied, none failed or unfinished, each checksum matching its file, ending with MIG-03`);
  checkPending(rows, io.migrationsOnDisk());
  io.ok(`pending: exactly ${MIG}`);
  checkPrismaTarget(io.prismaTarget());
  io.ok("Prisma's own tool resolves to the verified target, and lists MIG-04 as pending");
  const drift = io.driftFromBefore();
  if (drift.code !== 0) stop(`the database doesn't equal the schema before MIG-04 (exit ${drift.code}). ${drift.out.slice(0, 800)}`);
  io.ok("no drift: the database equals the schema at main, before MIG-04");
  const objects = await io.bodyMetricObjects();
  if (objects.tbl || objects.kinds) stop("MIG-04's objects already exist.");
  io.ok("MIG-04's objects don't exist yet");
  return { identity, rows };
}

/** The recorded state is for this database, and its marker and migration records haven't been rewritten. */
function checkSameDatabase(state, identity, rows) {
  if (identity.fingerprint !== state.fingerprint) stop("the preflight record is for a different database. Run preflight again.");
  if (identity.markerVersion !== state.markerVersion) stop("the marker's row changed since preflight.");
  for (const r of rows) if (state.checksums[r.name] !== r.checksum) stop(`a migration's record changed since preflight: ${r.name}`);
}

/**
 * All of it again, straight before applying, and then the deploy. What's only local comes first, so a bad record stops with no
 * connection. Row counts come last of all, so they're as close to the deploy as they can be. Any failure throws, and the deploy
 * is the only thing here that writes to the database.
 */
async function applyStep(io, now) {
  const state = checkState(io.readState(), now, { maxAgeMs: MAX_AGE_TO_APPLY_MS, needBackup: true });
  checkBackupFile(state.backup, io);
  const { identity, rows } = await verifyBeforeMigration(io);
  checkSameDatabase(state, identity, rows);
  io.ok("same database, marker and migration records as at preflight");
  checkCounts(state.counts, io.archiveRowCounts(state.backup.file), "the backup doesn't match the record");
  checkBackupFile(state.backup, io);
  checkCounts(state.counts, await io.rowCounts(), "changed since the backup");
  io.ok("nothing has changed since the backup");
  return io.deploy();
}

module.exports = {
  Stop, stop, TARGET, MIG, EXPECTED_BLOB, APPLIED_BEFORE, MAX_AGE_TO_APPLY_MS, MAX_AGE_TO_VERIFY_MS, BACKUP_NAME,
  checkState, checkBackupFile, checkIdentity, checkApplied, checkPending, checkPrismaTarget, checkCounts, checkSameDatabase, verifyBeforeMigration, applyStep,
};
