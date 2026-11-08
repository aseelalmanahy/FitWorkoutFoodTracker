// Migrations on disk that the owner hasn't approved, for databases that keep data (fitdb_review, production).
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..", "..");

function unapprovedMigrations(root = ROOT) {
  const approved = new Set(JSON.parse(fs.readFileSync(path.join(root, "prisma", "approved-migrations.json"), "utf8")).approved);
  return fs.readdirSync(path.join(root, "prisma", "migrations")).filter((d) => /^\d{14}_/.test(d) && !approved.has(d)).sort();
}

module.exports = { unapprovedMigrations };
