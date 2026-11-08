// Migrations on disk that the owner hasn't approved, for databases that keep data (fitdb_review, production).
//
// prisma migrate deploy applies every folder in prisma/migrations that holds a migration.sql, whatever it's called. So
// every folder counts here, not only the usual timestamped names, and an approved migration also has to match the
// SHA-256 recorded when it was approved: one edited since is reported as not approved. Line endings are normalised
// first, so a Windows checkout gives the same hash.
"use strict";
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")).digest("hex");

function unapprovedMigrations(root = ROOT) {
  const list = JSON.parse(fs.readFileSync(path.join(root, "prisma", "approved-migrations.json"), "utf8"));
  const approved = new Set(list.approved);
  const dir = path.join(root, "prisma", "migrations");
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue; // migration_lock.toml
    const name = entry.name;
    if (!approved.has(name)) { out.push(name); continue; }
    const sql = path.join(dir, name, "migration.sql");
    if (!fs.existsSync(sql) || sha256(sql) !== list.sha256?.[name]) out.push(`${name} (changed since it was approved)`);
  }
  return out.sort();
}

module.exports = { unapprovedMigrations, sha256 };
