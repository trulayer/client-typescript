#!/usr/bin/env node

// src/cli.ts
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname(__filename);
var [, , command, ...flags] = process.argv;
function printUsage() {
  process.stdout.write("Usage: npx @trulayer/skills <command>\n\n");
  process.stdout.write("Commands:\n");
  process.stdout.write("  install    Copy TruLayer slash commands into .claude/commands/\n");
  process.stdout.write("  list       List available skills without installing\n");
}
if (!command || command === "--help" || command === "-h") {
  printUsage();
  process.exit(0);
}
var skillsDir = resolve(__dirname, "..", "skills");
var skillFiles = readdirSync(skillsDir).filter((f) => f.endsWith(".md"));
if (command === "list") {
  process.stdout.write("Available TruLayer skills:\n\n");
  for (const file of skillFiles) {
    const name = file.replace(".md", "");
    process.stdout.write(`  /${name}
`);
  }
  process.stdout.write("\nRun `npx @trulayer/skills install` to add them to your project.\n");
} else if (command === "install") {
  const force = flags.includes("--force") || flags.includes("-f");
  const targetDir = resolve(process.cwd(), ".claude", "commands");
  mkdirSync(targetDir, { recursive: true });
  let installed = 0;
  let skipped = 0;
  for (const file of skillFiles) {
    const dest = resolve(targetDir, file);
    if (existsSync(dest) && !force) {
      process.stdout.write(`  skip  ${file} (already exists \u2014 use --force to overwrite)
`);
      skipped++;
    } else {
      copyFileSync(resolve(skillsDir, file), dest);
      process.stdout.write(`  added ${file}
`);
      installed++;
    }
  }
  process.stdout.write("\n");
  if (installed > 0) {
    process.stdout.write(`${installed} skill(s) installed to .claude/commands/
`);
    process.stdout.write("Restart Claude Code to activate the new slash commands.\n");
  } else {
    process.stdout.write(`No new skills installed (${skipped} already present).
`);
    process.stdout.write("Use --force to overwrite existing files.\n");
  }
} else {
  process.stderr.write(`Unknown command: ${command}

`);
  printUsage();
  process.exit(1);
}
