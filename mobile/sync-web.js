// Cross-platform replacement for the old `cp ../*.html ...` shell command,
// which only worked in a Unix-style shell (bash/WSL/Git Bash) and failed
// outright in plain Windows cmd.exe (no mkdir -p, no glob expansion, no
// 2>/dev/null). This does the same thing with plain Node fs calls, so it
// runs identically on Windows, Mac, and Linux.
const fs = require('fs');
const path = require('path');

const rootDir = path.join(__dirname, '..');
const wwwDir = path.join(__dirname, 'www');
const extensions = ['.html', '.js', '.css', '.json', '.jpg', '.png'];

// Directories (relative to rootDir) that should never be walked into —
// build output, other platform wrappers, and non-web-app folders.
const skipDirs = new Set([
  'mobile', 'desktop', 'node_modules', '.git',
  'supabase', 'supabase_migrations', 'docs',
]);

fs.mkdirSync(wwwDir, { recursive: true });

let copiedCount = 0;

// Recursively walk rootDir so nested folders like src/styles/pages and
// src/pages get copied too, not just files sitting directly in the repo
// root. Previously this only did a single-level fs.readdirSync, so every
// page's CSS/JS under src/ was silently skipped and never reached the
// mobile app's www bundle.
function walk(currentDir) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(currentDir, entry.name);
    const relPath = path.relative(rootDir, srcPath);

    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      walk(srcPath);
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      const destPath = path.join(wwwDir, relPath);
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
      copiedCount++;
    }
  }
}

walk(rootDir);

console.log(`sync-web: copied ${copiedCount} files into mobile/www/`);
