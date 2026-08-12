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

fs.mkdirSync(wwwDir, { recursive: true });

const files = fs.readdirSync(rootDir, { withFileTypes: true })
  .filter(entry => entry.isFile() && extensions.includes(path.extname(entry.name)));

for(const entry of files){
  fs.copyFileSync(path.join(rootDir, entry.name), path.join(wwwDir, entry.name));
}

console.log(`sync-web: copied ${files.length} files into mobile/www/`);
