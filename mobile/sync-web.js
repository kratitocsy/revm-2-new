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

// Directories inside the repo root that should never end up in the mobile
// bundle - the mobile app itself (avoids copying mobile/ into mobile/www/
// recursively), and dev/build tooling that isn't part of the served site.
const skipDirs = new Set(['mobile', 'node_modules', '.git', 'desktop', 'supabase']);

fs.mkdirSync(wwwDir, { recursive: true });

let copied = 0;

function syncDir(srcDir, destDir) {
  const entries = fs.readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (skipDirs.has(entry.name)) continue;
      syncDir(path.join(srcDir, entry.name), path.join(destDir, entry.name));
    } else if (entry.isFile() && extensions.includes(path.extname(entry.name))) {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(path.join(srcDir, entry.name), path.join(destDir, entry.name));
      copied++;
    }
  }
}

syncDir(rootDir, wwwDir);

console.log(`sync-web: copied ${copied} files into mobile/www/ (recursive)`);
